"""Build and sign the native APK with Android SDK 35 and a JDK."""
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]
os.chdir(root)
sdk = Path(os.environ["ANDROID_HOME"])
tools = sdk / "build-tools" / "35.0.0"
platform = sdk / "platforms/android-35/android.jar"
output = root / ".runtime/Abyssinia-AI.apk"
output.parent.mkdir(exist_ok=True)

def run(*args):
    subprocess.run([str(a) for a in args], check=True)

with tempfile.TemporaryDirectory() as directory:
    temp = Path(directory)
    classes, dex = temp / "classes", temp / "dex"
    classes.mkdir()
    dex.mkdir()
    run(tools / "aapt2", "compile", "--dir", "android/res", "-o", temp/"res.zip")
    run(tools / "aapt2", "link", "-I", platform, "--manifest", "android/AndroidManifest.xml", "-o", temp/"base.apk", temp/"res.zip")
    run("javac", "--release", "8", "-encoding", "UTF-8", "-classpath", platform, "-d", classes, *Path("android/src").rglob("*.java"))
    run("jar", "cf", temp/"classes.jar", "-C", classes, ".")
    run(tools/"d8", "--release", "--min-api", "26", "--lib", platform, "--output", dex, temp/"classes.jar")
    with zipfile.ZipFile(temp/"base.apk","a") as package:
        package.write(dex/"classes.dex","classes.dex",compress_type=zipfile.ZIP_DEFLATED)
    run(tools/"zipalign", "-f", "-p", "4", temp/"base.apk", temp/"aligned.apk")
    run(tools/"apksigner","sign","--ks",os.environ["ANDROID_KEYSTORE"],"--ks-key-alias","abyssinia","--ks-pass","env:ANDROID_STORE_PASS","--out",output,temp/"aligned.apk")
    run(tools/"apksigner","verify","--verbose","--print-certs",output)
