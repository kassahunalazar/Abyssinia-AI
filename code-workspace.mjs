import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const allowed = new Set('.js .mjs .cjs .ts .tsx .jsx .py .css .html .go .rs .java .c .cpp .h .cs .md .txt'.split(' '));
const limit = 64 * 1024;

export function isSourceFile(path) {
  return allowed.has(extname(path).toLowerCase());
}

export function snapshotFile(path, identity) {
  if (!isAbsolute(path) || !isSourceFile(path) || basename(path).startsWith('.') ||
      resolve(path).split(/[\\/]/).some(p => ['.git','.runtime','node_modules','.ssh'].includes(p.toLowerCase())) ||
      realpathSync(path) !== resolve(path)) throw Error('invalid');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit || stat.nlink !== 1) throw Error('invalid');
  const exact = lstatSync(path, {bigint:true});
  const fileId = String(exact.dev) + '/' + String(exact.ino);
  if (identity && identity !== fileId) throw Error('stale');
  const bytes = readFileSync(path);
  if (bytes.length > limit || bytes.includes(0)) throw Error('invalid');
  const text = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes);
  return {text, mode:stat.mode, fileId};
}

export function replaceReviewed(path, before, after, identity) {
  if (typeof after !== 'string' || after.includes('\0') || Buffer.byteLength(after)>limit || before===after) throw Error('invalid');
  const original=snapshotFile(path, identity);
  if (original.text !== before) throw Error('stale');
  const temp=join(dirname(path),'.abyssinia-'+randomUUID()+'.tmp');
  const fd=openSync(temp,'wx',original.mode);
  let replaced=false;
  try {
    try {writeFileSync(fd,after,'utf8'); fsyncSync(fd);} finally {closeSync(fd);}
    if (snapshotFile(path, original.fileId).text!==before) throw Error('stale');
    renameSync(temp,path);
    replaced=true;
    return snapshotFile(path).fileId;
  } finally {if(!replaced)unlinkSync(temp);}
}

export function pickSourceFile(signal) {
  if(process.platform!=='win32')throw Error('unsupported');
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d=New-Object System.Windows.Forms.OpenFileDialog',
    "$d.Title='Abyssinia AI - grant access to one source file'",
    "$d.Filter='Source and text|*.js;*.mjs;*.cjs;*.ts;*.tsx;*.jsx;*.py;*.css;*.html;*.go;*.rs;*.java;*.c;*.cpp;*.h;*.cs;*.md;*.txt'",
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)',
    'if($d.ShowDialog() -eq [Windows.Forms.DialogResult]::OK){[Console]::Write($d.FileName)}',
    '$d.Dispose()',
  ].join(';');
  return new Promise((accept,reject)=>{
    const child=spawn(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-STA','-Command',script],{signal,timeout:120000,windowsHide:true,stdio:['ignore','pipe','ignore']});
    const chunks=[];child.stdout.on('data',c=>chunks.push(c));child.on('error',reject);
    child.on('close',code=>code===0?accept(Buffer.concat(chunks).toString('utf8')):reject(Error('picker')));
  });
}

// Parse the draft over stdin. Neither language runs the user's program.
export function checkDraft(path, text, signal) {
  if(typeof text!=='string' || Buffer.byteLength(text)>limit)throw Error('invalid');
  const extension=extname(path).toLowerCase();
  const python=extension==='.py';
  if(!python && !['.mjs','.cjs','.js'].includes(extension))throw Error('unsupported');
  const args=python ? ['-I','-S','-c',"import ast,sys; ast.parse(sys.stdin.buffer.read().decode('utf-8-sig'))"] :
    ['--input-type='+ (extension==='.cjs'?'commonjs':'module'),'--check'];
  return new Promise((accept,reject)=>{
    const child=spawn(python?process.env.ASSISTANT_PYTHON:process.execPath,args,{
      env:{SystemRoot:process.env.SystemRoot},signal,timeout:8000,windowsHide:true,stdio:['pipe','ignore','pipe']
    });
    let error='';
    child.stderr.on('data',chunk=>{if(error.length<1024)error+=chunk.toString()});
    child.stdin.on('error',()=>{});
    child.on('error',reject);
    child.on('close',(code,reason)=>{
      if(reason||code===null)return reject(Error('unavailable'));
      const match=(python?/line (\d+)/:/\[stdin\]:(\d+)/).exec(error);
      accept({valid:code===0,line:match?Number(match[1]):null});
    });
    child.stdin.end(text);
  });
}
