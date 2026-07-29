# MMD LAB

ブラウザで動作するローカル専用の Three.js MMD ビューワーです。

## Features

- PMX / PMD モデル、VMD モーション、VPD ポーズの読み込み
- フォルダ、ZIP、複数ファイルの一括投入と複数モデルの同時表示
- 添付の待機・素立ち VMD を標準アイドルとして自動適用
- モーフ操作、再生・ループ、カメラプリセット
- 実MMDモーフによる非累積の瞬き、視線・マイクロサッカード、呼吸、部位別姿勢ゆらぎ
- モデルの複数選択、同期再生、自動整列、グループ移動
- クリックによる物理つつき、ドラッグによる剛体の引っ張り
- 固定ステップ MMD 物理、拘束調整、空気抵抗、風・乱流、部位別制御
- MMDToonMaterial本来のシェーダーを維持した安全な材質調整、アウトライン、ACES、HDRI、影、グリッド
- ローカルでベイクした固定背景GLBの自動読み込み
- WebXR / VRButton、local-floor、VR向け実寸ステージ、コントローラーレイ
- XR時の軽量描画とデスクトップ時の自動解像度調整

モデルデータはブラウザ内でのみ処理され、サーバーへ送信されません。

## Private built-in background

固定背景はキャラクター用のMMDランタイムとは別に、静的GLBへベイクして読み込みます。元のPMX、テクスチャ、生成データは`private/`に置かれ、Gitの管理対象にはなりません。生成したGLBはgzip圧縮してJavaScriptバンドルへ埋め込まれるため、元ファイルを公開する個別URLは作られません。

```sh
mkdir -p private
# 添付ZIPを private/blender&MMD.zip として配置
npm run prepare:background
npm run dev
```

背景生成と開発サーバー起動を続けて行う場合:

```sh
npm run dev:background
```

別の場所にあるZIPを使う場合:

```sh
npm run prepare:background -- --source "/path/to/blender&MMD.zip"
```

生成物は`private/background-data.ts`です。生成物がない通常のビルドでは、従来の床とグリッドへフォールバックします。ブラウザへ描画データを送る以上、実行中データの完全な抽出防止はできないため、この構成はローカル利用を前提とします。

## Development

実装は TypeScript で機能別に分割されています。

- `src/scene.ts` / `src/xr.ts`: Three.js、照明、HDRI、WebXR、実寸ステージ
- `src/background.ts` / `scripts/build-background.py`: 固定背景の埋め込みと静的PMXベイク
- `src/storage.ts` / `src/assets.ts`: IndexedDB、ZIP、ファイル分類
- `src/motion.ts`: 標準VMD、終端シーム補正、クロスフェード、複数モデル同期
- `src/life.ts` / `src/life-math.ts`: 実モーフ瞬き、視線、呼吸、部位別の微細動作
- `src/interaction.ts`: 選択、グループ移動、物理つつき、引っ張り
- `src/physics.ts`: 固定ステップ Ammo.js / MMDPhysics ランタイム
- `src/models.ts` / `src/materials.ts`: モデル、リグ、トゥーン材質
- `src/editor.tsx`: React / shadcn編集UI
- `src/app.ts`: XR対応フレーム更新と動的解像度

```sh
npm install
npm run typecheck
npm run build
npm run check
```

Viteは`build/client`へクライアントを出力します。WebXRはHTTPSまたはlocalhost上で利用してください。

実装上の根拠とパラメーター設計は [`docs/behavior-model.md`](docs/behavior-model.md) にまとめています。
