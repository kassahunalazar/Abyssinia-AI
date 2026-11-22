"""Offline, single-speaker Amharic synthesis using the MMS evaluation checkpoint."""
import io
import json
import re
import sys
import wave
from pathlib import Path

def synthesize(directory, text):
    sys.path.insert(0, str(directory / "dependencies"))
    import numpy as np
    import onnxruntime as ort
    from uroman import Uroman

    tokens = {}
    for line in (directory / "tokens.txt").read_text(encoding="utf-8").splitlines():
        symbol, token = line.rsplit(" ", 1)
        tokens[symbol] = int(token)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(directory / "model.onnx"), options, providers=["CPUExecutionProvider"])
    romanizer = Uroman()
    audio = io.BytesIO()
    with wave.open(audio, "wb") as out:
        out.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        for sentence in re.split(r"[።፧!?\n]+", text):
            words = romanizer.romanize_string(sentence, lcode="amh").lower().split()
            while words:
                chunk = []
                length = 0
                while words and (not chunk or length + len(words[0]) <= 180):
                    word = words.pop(0)
                    if len(word) > 200:
                        raise ValueError("Word too long")
                    length += len(word) + 1
                    chunk.append(word)
                ids = [tokens[c] for c in " ".join(chunk) if c in tokens]
                if not ids:
                    continue
                x = np.zeros((1, 2 * len(ids) + 1), dtype=np.int64)
                x[0, 1::2] = ids
                params = dict(x=x, x_length=np.array([x.size], dtype=np.int64))
                for name, value in (("noise_scale", .667), ("length_scale", 1.), ("noise_scale_w", .8)):
                    params[name] = np.array([value], dtype=np.float32)
                samples = session.run(None, params)[0].ravel()
                if not np.isfinite(samples).all() or not samples.size or audio.tell()+samples.size*2 > 10_000_000:
                    raise ValueError("Invalid output")
                out.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
                out.writeframes(bytes(3200))
    if audio.tell() <= 44:
        raise ValueError("No speech")
    return audio.getvalue()


if __name__ == "__main__":
    text = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    if not isinstance(text, str) or not 0 < len(text) <= 2000:
        raise ValueError("Invalid input")
    sys.stdout.buffer.write(synthesize(Path(sys.argv[1]), text))
