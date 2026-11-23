# Third-party notices

The project license covers original Abyssinia AI source. The following components retain their respective copyrights and licenses.

| Component | Distribution and notices |
| --- | --- |
| Node.js | Bundled in the Windows download. The build includes the Node.js license and bundled dependency notices in Node-LICENSE.txt. |
| QuickJS and quickjs-emscripten | The JavaScript project test runner includes the engine and wrapper. [Bundled notices](vendor/quickjs/LICENSE) |
| Noto Sans Ethiopic | Windows interface fallback font, distributed under the SIL Open Font License. [Bundled license](web/fonts/OFL.txt) |
| Ethiopia Jiret, Ethiopic Yigezu Bisrat Gothic and Waldba Fantuwua | Used by name when installed on the user's Windows system. Their font files are not included in the downloads. |
| Hermes Agent | The Windows setup downloads a pinned revision from [Nous Research](https://github.com/NousResearch/hermes-agent/tree/2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19). Its upstream notices apply to the engine. |
| Optional Hohe Amharic speech recognition weights | Downloaded separately. Credit to Chapi and Dataset.ET for the original model and Yaredoffice for the INT8 ONNX conversion. [Model](https://huggingface.co/snapwre/hohe-asr-amharic) · [Conversion](https://huggingface.co/Yaredoffice/hohe-asr-amharic-onnx-int8) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

The Android client uses Android system APIs and the system font. No model weights or user credentials are bundled.
