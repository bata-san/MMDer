# MMD LAB

ブラウザで動作するローカル専用の Three.js MMD ビューワーです。

## Features

- PMX / PMD モデル、VMD モーション、VPD ポーズの読み込み
- フォルダ、ZIP、複数ファイルの一括投入と複数モデルの同時表示
- 添付の待機・素立ち VMD を標準アイドルとして自動適用
- モーフ操作、再生・ループ、カメラプリセット
- 固定ステップ MMD 物理、拘束調整、空気抵抗、風・乱流、部位別制御
- 材質別トゥーン補助、アウトライン、ACES、HDRI、影、グリッド
- WebXR / VRButton、local-floor、VR向け実寸ステージ、コントローラーレイ
- XR時の軽量描画とデスクトップ時の自動解像度調整

モデルデータはブラウザ内でのみ処理され、サーバーへ送信されません。

## Development

実装は TypeScript で機能別に分割されています。

- `src/scene.ts` / `src/xr.ts`: Three.js、照明、HDRI、WebXR、実寸ステージ
- `src/storage.ts` / `src/assets.ts`: IndexedDB、ZIP、ファイル分類
- `src/motion.ts`: 標準VMD、VMD / VPD、クロスフェード
- `src/physics.ts`: 固定ステップ Ammo.js / MMDPhysics ランタイム
- `src/models.ts` / `src/materials.ts`: モデル、リグ、トゥーン材質
- `src/views.ts` / `src/ui.ts`: DOM描画とイベント配線
- `src/app.ts`: XR対応フレーム更新と動的解像度

```sh
npm install
npm run typecheck
npm run build
```

コンパイル済みの `dist/*.js` も管理対象なので、デプロイ時はビルド不要です。WebXRはHTTPSまたはlocalhost上で利用してください。
