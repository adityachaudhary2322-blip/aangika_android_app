# ASL isolated signs: Kaggle ISLR 1st place (ONNX)

| | |
|---|---|
| Source | https://huggingface.co/sign/kaggle-asl-signs-1st-place (`model.tflite`, sha256 `F55A2BB1…0BB7`), the winning entry of Google's Isolated Sign Language Recognition competition (Hoyeol Sohn, code: https://github.com/hoyso48/Google---Isolated-Sign-Language-Recognition-1st-place-solution) |
| Licence | weights **MIT**, code **MIT**; training data **PopSign ASL v1.0, CC BY 4.0**. Commercial use allowed with attribution. |
| Attribution | Hoyeol Sohn (ISLR 1st place); PopSign ASL v1.0, Georgia Tech / Google |
| This file | `model.onnx`: converted with tf2onnx 1.17 (opset 17) by `training/asl/convert_islr.py`. Matches the TFLite interpreter to ≤ 2.7e-6 with identical top-1 on 6 test clips (8-96 frames, missing face / hands). 22.2 MB (the TFLite's compressed weights are stored as float32). |
| Input | `serving_default_inputs:0` float32 `[frames, 543, 3]`: MediaPipe Holistic layout, face 0-467, left hand 468-488, pose 489-521, right hand 522-542, (x, y, z) normalised image coordinates, **NaN = not detected**. The graph selects ~118 points (lips, hands, some face/pose) and normalises internally. |
| Output | 250 scores (not probabilities); the app applies softmax. Labels in `vocab.json` (index order). |
| Vocabulary | 250 everyday signs (hello, thankyou, please, yes, no, water, drink, food, hungry, mom, dad, where, who, why, tomorrow, sick, home, …). |
| Accuracy | **Not measured in this app.** Reported on the competition's held-out data, which uses Holistic landmarks; not re-verified here. The app feeds MediaPipe **Tasks** landmarks (the detector differs), so real-world accuracy must be measured before any claim. |
| Runtime cost | onnxruntime-web (wasm, 1 thread): 18-29 ms per 30-60-frame window on a laptop CPU. Needs the MediaPipe face landmarker (+3.8 MB download, a third detector per frame). |
