# Third-Party Notices

SubSync2 remains a GPL-3.0 derivative of the original SubSync project by
Michał Szymaniak (sc0ty). See `README.md`, `LICENSE`, and `UPSTREAM_COMMIT`
for the primary project license and upstream attribution.

The Romanian local speech-recognition path additionally uses the components
listed below. These notices do not replace the applicable upstream licenses.

## whisper.cpp

- Project: `ggml-org/whisper.cpp`
- Pinned release: `v1.5.4`
- Pinned commit: `0b9af32a8b3fa7e2ae5f15a9a08f5b10394993f5`
- License: MIT

MIT License

Copyright (c) 2023 Georgi Gerganov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## OpenAI Whisper model

The Romanian browser path uses a quantized GGML conversion of the OpenAI
Whisper Tiny model:

- Model file: `ggml-tiny-q5_1.bin`
- Canonical model repository: `ggerganov/whisper.cpp`
- Pinned model revision: `5359861c739e955e79d9a303bcbc70fb988958b1`
- SHA-256: `818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7`
- License metadata: MIT

MIT License

Copyright (c) 2022 OpenAI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Deterministic CI voices

The Piper voices used to generate deterministic English and Romanian
regression fixtures are CI-only test dependencies. They are not shipped in
the SubSync2 PWA. Their pinned source/model metadata and dataset-license
metadata are recorded in the repository configuration and fixture preparation
scripts.
