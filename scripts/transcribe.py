"""Transcribe bounded mono 16 kHz signed PCM using an installed offline model."""
import json
import sys
from pathlib import Path
import numpy as np

def transcribe_hohe(samples, path):
    import onnxruntime as ort
    with np.load(path / "assets/frontend.npz", allow_pickle=False) as constants:
        frames = np.lib.stride_tricks.sliding_window_view(samples.astype(np.float64), 400)[::160].copy()
        frames -= frames.mean(axis=1, keepdims=True)
        frames[:, 1:] -= 0.97 * frames[:, :-1].copy()
        frames[:, 0] *= 0.03
        power = np.abs(np.fft.rfft(frames * constants["window"], n=512)) ** 2
        features = np.log(np.maximum(power @ constants["mel_filters"], 1.192092955078125e-7)).astype(np.float32)
    features = (features - features.mean(axis=0)) / np.sqrt(features.var(axis=0, ddof=1) + 1e-7)
    count = len(features)
    if count % 2:
        features = np.pad(features, ((0,1),(0,0)), constant_values=1)
    features = features.reshape(1,-1,160)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(path / "model.onnx"), options, providers=["CPUExecutionProvider"])
    mask = np.ones(features.shape[:2], dtype=np.int64)
    if count % 2:
        mask[0,-1] = 0
    feed = {i.name: mask if "mask" in i.name else features for i in session.get_inputs()}
    logits = session.run(None, feed)[0][0]
    meta = json.loads((path / "assets/meta.json").read_text(encoding="utf-8"))
    ids = logits.argmax(axis=-1)
    collapsed = ids[np.r_[True, ids[1:] != ids[:-1]]]
    skip = set(meta["suppress_ids"]) | {meta["blank_id"], meta["unk_id"]}
    return "".join(meta["tokens"][i] for i in collapsed if i not in skip).replace(meta["word_delimiter"], " ").strip()

def main():
    pcm = sys.stdin.buffer.read(16_000 * 2 * 20 + 1)
    if not 8000 <= len(pcm) <= 640000 or len(pcm) % 2:
        raise ValueError("Invalid recording")
    raw = np.frombuffer(pcm, dtype="<i2")
    path = Path(sys.argv[1])
    if (path / "model.onnx").exists():
        print(json.dumps({"text": transcribe_hohe(raw, path)}, ensure_ascii=True))
        return
    from faster_whisper import WhisperModel
    samples = raw.astype(np.float32) / 32768
    model = WhisperModel(sys.argv[1], device="cpu", compute_type="int8", cpu_threads=2, local_files_only=True)
    segments, _ = model.transcribe(
        samples, language="am", beam_size=1, condition_on_previous_text=False,
        vad_filter=False,
    )
    print(json.dumps({"text": " ".join(s.text.strip() for s in segments).strip()}, ensure_ascii=True))

if __name__ == "__main__":
    main()
