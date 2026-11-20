const form = document.querySelector('form');
const input = document.querySelector('textarea');
const button = document.querySelector('button');
const messages = document.querySelector('#messages');
const status = document.querySelector('#status');

function append(label, text) {
  const card = document.createElement('article');
  const heading = document.createElement('strong');
  const content = document.createElement('p');
  heading.textContent = label;
  content.textContent = text;
  card.append(heading, content);
  messages.append(card);
  card.scrollIntoView({ block: 'nearest' });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || button.disabled) return;
  button.disabled = true;
  status.textContent = 'በመጠበቅ ላይ…';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) throw new Error('Chat failed');
    const { reply } = await response.json();
    append('እርስዎ', message);
    append('ረዳት', reply);
    input.value = '';
    status.textContent = '';
  } catch {
    status.textContent = 'መልስ ማግኘት አልተቻለም። እባክዎ እንደገና ይሞክሩ።';
  } finally {
    button.disabled = false;
    input.focus();
  }
});
