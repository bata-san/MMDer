# MMD LAB

ブラウザで動作するローカル専用の Three.js MMD ビューワーです。

## Features

- PMX / PMD モデル、VMD モーション、VPD ポーズの読み込み
- フォルダ、ZIP、複数ファイルの一括投入と複数モデルの同時表示
- モーフ操作、再生・ループ、カメラプリセット
- 呼吸・重心・視線を重ねるプロシージャルフロー
- MMD 物理、風・乱流、部位別の有効化
- トゥーン風アウトライン、ACES トーンマッピング、HDRI、影、グリッド

モデルデータはブラウザ内でのみ処理され、サーバーへ送信されません。

## Development

実装は TypeScript で機能別に分割されています。

- `src/scene.ts`: Three.js のシーン、カメラ、レンダラー、HDRI
- `src/storage.ts` / `src/assets.ts`: IndexedDB、ZIP、ファイル分類
- `src/motion.ts`: VMD / VPD、アイドル、呼吸、瞬き
- `src/physics.ts`: Ammo.js と MMDPhysics
- `src/models.ts` / `src/materials.ts`: モデル、リグ、マテリアル
- `src/views.ts` / `src/ui.ts`: DOM描画とイベント配線
- `src/app.ts`: 起動とフレーム更新

```sh
npm install
npm run typecheck
npm run build
```

コンパイル済みの `dist/*.js` も管理対象なので、デプロイ時はビルド不要です。ローカル確認には任意の静的HTTPサーバーを使用してください。
