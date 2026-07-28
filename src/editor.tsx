import {
  Clapperboard,
  FolderOpen,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RotateCcw,
  Smile,
  Sparkles,
  Trash2,
  Wind,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { importAssets } from "./assets";
import { forceBlink } from "./life";
import {
  applyMotion,
  morphMeshes,
  seekMotions,
  setMotionLooping,
  synchronizeMotions,
} from "./motion";
import {
  arrangeModels,
  clearModelSelection,
  clearModels,
  loadModel,
  onActiveModelChange,
  onModelsChange,
  selectAllModels,
  setActiveModel,
  setRigEditing,
  toggleModelSelection,
} from "./models";
import {
  applyPhysicsSettings,
  disablePhysics,
  enablePhysics,
  PHYSICS_PARTS,
  resetAllPhysics,
} from "./physics";
import {
  applyOutlineScale,
  applyToonSettings,
  eachMaterial,
} from "./materials";
import {
  camera,
  controls,
  grid,
  loadHdr,
  renderer,
  scene,
  setEnvironmentStrength,
} from "./scene";
import { BUILD_VERSION, state } from "./state";
import { removeStoredAsset, removeStoredAssets } from "./storage";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const tabs = [
  ["view", "表示", Monitor],
  ["motion", "モーション", Clapperboard],
  ["life", "生命感", Sparkles],
  ["physics", "物理", Wind],
  ["morph", "モーフ", Smile],
] as const;
type ControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
};
function Control({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
}: ControlProps) {
  const [current, setCurrent] = useState(value);
  useEffect(() => setCurrent(value), [value]);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <output className="font-mono text-muted-foreground">
          {current.toFixed(step >= 1 ? 0 : 2)}
        </output>
      </div>
      <Slider
        value={[current]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => {
          setCurrent(next);
          onChange(next);
        }}
      />
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const [current, setCurrent] = useState(checked);
  useEffect(() => setCurrent(checked), [checked]);
  return (
    <label className="flex items-center justify-between text-xs">
      <span>{label}</span>
      <Switch
        checked={current}
        onCheckedChange={(next) => {
          setCurrent(next);
          onChange(next);
        }}
      />
    </label>
  );
}
function LibraryList({
  title,
  items,
  onOpen,
  onChange,
}: {
  title: string;
  items: typeof state.assets;
  onOpen: (file: File) => void;
  onChange: () => void;
}) {
  return (
    <section className="min-h-0 space-y-2">
      <div className="flex items-center justify-between text-xs font-medium">
        <span>{title}</span>
        <span className="text-muted-foreground">{items.length}</span>
      </div>
      <div className="h-40 overflow-y-auto rounded border">
        <div className="space-y-1 p-1">
          {items.map((asset) => (
            <div className="flex items-center gap-1" key={asset.id}>
              <Button
                className="h-8 min-w-0 flex-1 justify-start truncate px-2 text-xs"
                variant="ghost"
                onClick={() => onOpen(asset.file)}
              >
                {asset.name}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                title="ライブラリから削除"
                onClick={() => {
                  void removeStoredAsset(asset.id).then(onChange);
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
          {!items.length && (
            <p className="p-2 text-xs text-muted-foreground">
              保存済みの項目はありません。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export function Editor() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(340);
  const [dark, setDark] = useState(true);
  const [morphQuery, setMorphQuery] = useState("");
  const [materialQuery, setMaterialQuery] = useState("");
  const [, redraw] = useState(0);
  const folder = useRef<HTMLInputElement>(null);
  const motion = useRef<HTMLInputElement>(null);
  const hdri = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    window.dispatchEvent(new Event("mmdlab-theme-change"));
  }, [dark]);
  useEffect(() => {
    const refresh = () => redraw((n) => n + 1);
    const stopModels = onModelsChange(refresh);
    const stopActive = onActiveModelChange(refresh);
    return () => {
      stopModels();
      stopActive();
    };
  }, []);
  const addAssets = (files: FileList | null, immediate = false) => {
    if (!files?.length) return;
    void importAssets(files, immediate)
      .catch((error) => console.error("Asset import failed.", error))
      .finally(() => redraw((n) => n + 1));
  };
  const library = state.assets.filter((asset) => asset.kind === "model");
  const motions = state.assets.filter((asset) => asset.kind === "motion");
  const layout = `${leftOpen ? `${leftWidth}px` : "0px"} minmax(0,1fr) ${rightOpen ? `${rightWidth}px` : "0px"}`;
  const beginResize = (
    side: "left" | "right",
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;
    const move = (pointer: PointerEvent) => {
      const delta = pointer.clientX - startX;
      const width = side === "left" ? startWidth + delta : startWidth - delta;
      (side === "left" ? setLeftWidth : setRightWidth)(
        Math.max(200, Math.min(520, width)),
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const physics = (key: keyof typeof state.physicsSettings, value: number) => {
    (state.physicsSettings[key] as number) = value;
    state.models.forEach((model) => applyPhysicsSettings(model));
    redraw((n) => n + 1);
  };
  const setInteractionMode = (mode: typeof state.interactionSettings.mode) => {
    state.interactionSettings.mode = mode;
    redraw((n) => n + 1);
  };
  const matchesQuery = (name: string, query: string) =>
    name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  return (
    <main
      className="grid h-screen grid-rows-[48px_minmax(0,1fr)] bg-background text-foreground"
      style={{ gridTemplateColumns: layout }}
    >
      <input
        ref={folder}
        className="hidden"
        type="file"
        multiple
        {...({ webkitdirectory: "" } as any)}
        onChange={(e) => {
          addAssets(e.currentTarget.files);
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={motion}
        className="hidden"
        type="file"
        multiple
        accept=".vmd,.vpd"
        onChange={(e) => {
          addAssets(e.currentTarget.files);
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={hdri}
        className="hidden"
        type="file"
        accept=".hdr"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) loadHdr(file);
        }}
      />
      <header className="col-span-3 flex items-center gap-3 border-b px-3">
        <span className="size-3 rounded-sm bg-foreground" />
        <span className="text-sm font-medium">無題のシーン</span>
        <span className="text-xs text-muted-foreground">
          {state.models.length} モデル
        </span>
        <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {BUILD_VERSION}
        </span>
        <div className="ml-auto flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setLeftOpen(!leftOpen)}
          >
            {leftOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setRightOpen(!rightOpen)}
          >
            {rightOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDark(!dark)}>
            {dark ? "ライト" : "ダーク"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => folder.current?.click()}
          >
            <FolderOpen />
            フォルダを追加
          </Button>
          <Button size="sm" onClick={() => motion.current?.click()}>
            モーション追加
          </Button>
        </div>
      </header>
      <aside className="relative overflow-hidden border-r">
        <div className="flex h-11 items-center justify-between border-b px-3">
          <span className="text-xs font-medium">アセット</span>
          <Button
            size="icon"
            variant="ghost"
            title="アセットをしまう"
            onClick={() => setLeftOpen(false)}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
        <ScrollArea className="asset-scroll h-[calc(100vh-92px)] p-3">
          <div className="space-y-4">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => folder.current?.click()}
            >
              <FolderOpen />
              ライブラリへ追加
            </Button>
            <Button
              className="w-full border-destructive text-destructive hover:bg-destructive hover:text-white"
              variant="outline"
              onClick={() => {
                if (window.confirm("保存したすべてのアセットを削除しますか？"))
                  void removeStoredAssets().then(() => redraw((n) => n + 1));
              }}
            >
              保存アセットを全削除
            </Button>
            <LibraryList
              title="モデルライブラリ"
              items={library}
              onOpen={(file) => void loadModel(file)}
              onChange={() => redraw((n) => n + 1)}
            />
            <LibraryList
              title="モーションライブラリ"
              items={motions}
              onOpen={(file) => void applyMotion(file)}
              onChange={() => redraw((n) => n + 1)}
            />
            <section className="border-t pt-3">
              <div className="mb-2 flex gap-1">
                <Button size="sm" variant="ghost" onClick={selectAllModels}>
                  全選択
                </Button>
                <Button size="sm" variant="ghost" onClick={clearModelSelection}>
                  解除
                </Button>
                <Button size="sm" variant="ghost" onClick={arrangeModels}>
                  整列
                </Button>
              </div>
              {state.models.map((model) => (
                <div
                  className={`flex items-center gap-1 rounded px-1 ${state.active === model ? "bg-muted" : ""}`}
                  key={model.id}
                >
                  <Button
                    className="h-8 min-w-0 flex-1 justify-start truncate px-2 text-xs"
                    variant="ghost"
                    onClick={() => {
                      setActiveModel(model);
                      redraw((n) => n + 1);
                    }}
                  >
                    {model.name}
                  </Button>
                  <Switch
                    checked={state.selectedModels.includes(model)}
                    onCheckedChange={(selected) => {
                      toggleModelSelection(model, selected);
                      redraw((n) => n + 1);
                    }}
                  />
                </div>
              ))}
              <Button
                className="mt-2"
                size="sm"
                variant="ghost"
                onClick={clearModels}
              >
                シーンをクリア
              </Button>
            </section>
          </div>
        </ScrollArea>
        <div
          role="separator"
          aria-orientation="vertical"
          className="absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize touch-none hover:bg-primary/30"
          onPointerDown={(event) => beginResize("left", event)}
        />
      </aside>
      <section
        id="viewport-canvas"
        className="relative overflow-hidden bg-muted/30"
      >
        <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:24px_24px]" />
      </section>
      <aside className="relative min-w-0 overflow-hidden border-l">
        <div className="flex h-9 items-center justify-between border-b px-2">
          <span className="text-xs font-medium">インスペクター</span>
          <Button
            size="icon"
            variant="ghost"
            title="設定をしまう"
            onClick={() => setRightOpen(false)}
          >
            <PanelRightClose className="size-4" />
          </Button>
        </div>
        <Tabs defaultValue="view" className="h-[calc(100%-36px)]">
          <TabsList className="grid h-12 w-full grid-cols-5 gap-0 rounded-none border-b bg-transparent p-1">
            {tabs.map(([id, label, Icon]) => (
              <TabsTrigger
                className="min-w-0 px-0"
                key={id}
                value={id}
                title={label}
              >
                <Icon className="size-4" />
                <span className="sr-only">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="view" className="m-0 h-[calc(100%-48px)]">
            <ScrollArea className="h-full p-4">
              <div className="space-y-5">
                <h2 className="text-sm font-medium">表示</h2>
                <div className="grid grid-cols-3 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      camera.position.set(0, 4.8, 12);
                      controls.update();
                    }}
                  >
                    正面
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      camera.position.set(8, 5.4, 12);
                      controls.update();
                    }}
                  >
                    斜め
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      camera.position.set(13, 9, 18);
                      controls.update();
                    }}
                  >
                    全体
                  </Button>
                </div>
                <Control
                  label="画角"
                  value={camera.fov}
                  min={20}
                  max={90}
                  step={1}
                  onChange={(v) => {
                    camera.fov = v;
                    camera.updateProjectionMatrix();
                  }}
                />
                <Control
                  label="明るさ"
                  value={renderer.toneMappingExposure}
                  min={0.4}
                  max={2}
                  step={0.1}
                  onChange={(v) => {
                    renderer.toneMappingExposure = v;
                  }}
                />
                <Control
                  label="環境光"
                  value={state.environmentStrength}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={setEnvironmentStrength}
                />
                <Control
                  label="輪郭線"
                  value={state.outlineScale * 0.28}
                  min={0}
                  max={1.5}
                  step={0.05}
                  onChange={(v) => {
                    state.outlineScale = v / 0.28;
                    applyOutlineScale();
                  }}
                />
                <Control
                  label="反射"
                  value={state.toonSettings.specular}
                  min={0}
                  max={1}
                  onChange={(v) => {
                    state.toonSettings.specular = v;
                    applyToonSettings();
                  }}
                />
                <Control
                  label="影の持ち上げ"
                  value={state.toonSettings.shadowLift}
                  min={0}
                  max={0.4}
                  onChange={(v) => {
                    state.toonSettings.shadowLift = v;
                    applyToonSettings();
                  }}
                />
                <Toggle
                  label="グリッド"
                  checked={grid.visible}
                  onChange={(v) => {
                    grid.visible = v;
                    redraw((n) => n + 1);
                  }}
                />
                <Toggle
                  label="影"
                  checked={renderer.shadowMap.enabled}
                  onChange={(v) => {
                    renderer.shadowMap.enabled = v;
                    redraw((n) => n + 1);
                  }}
                />
                <Toggle
                  label="輪郭線を有効化"
                  checked={state.outline}
                  onChange={(v) => {
                    state.outline = v;
                    redraw((n) => n + 1);
                  }}
                />
                <Toggle
                  label="HDRI 背景"
                  checked={scene.background === state.environment}
                  onChange={(v) => {
                    scene.background =
                      v && state.environment ? state.environment : null;
                  }}
                />
                <Toggle
                  label="リグ編集"
                  checked={state.rigHandles.length > 0}
                  onChange={setRigEditing}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => hdri.current?.click()}
                >
                  HDRI を選択
                </Button>
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="motion" className="m-0 p-4">
            <div className="space-y-5">
              <h2 className="text-sm font-medium">モーション</h2>
              <div className="grid grid-cols-3 gap-1">
                <Button
                  size="sm"
                  variant={
                    state.motionScope === "active" ? "secondary" : "outline"
                  }
                  onClick={() => {
                    state.motionScope = "active";
                  }}
                >
                  選択中
                </Button>
                <Button
                  size="sm"
                  variant={
                    state.motionScope === "selected" ? "secondary" : "outline"
                  }
                  onClick={() => {
                    state.motionScope = "selected";
                  }}
                >
                  複数選択
                </Button>
                <Button
                  size="sm"
                  variant={
                    state.motionScope === "all" ? "secondary" : "outline"
                  }
                  onClick={() => {
                    state.motionScope = "all";
                  }}
                >
                  すべて
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    state.playing = !state.playing;
                    redraw((n) => n + 1);
                  }}
                >
                  <Play />
                  {state.playing ? "一時停止" : "再生"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    state.elapsed = 0;
                    synchronizeMotions(true);
                    resetAllPhysics();
                  }}
                >
                  <RotateCcw />
                  最初から
                </Button>
              </div>
              <Toggle
                label="ループ"
                checked={state.loop}
                onChange={(v) => {
                  state.loop = v;
                  setMotionLooping(v);
                }}
              />
              <Control
                label="タイムライン"
                value={state.duration ? state.elapsed / state.duration : 0}
                min={0}
                max={1}
                step={0.001}
                onChange={(v) => {
                  if (state.duration) {
                    state.elapsed = v * state.duration;
                    seekMotions(state.elapsed);
                  }
                }}
              />
              <Control
                label="切替時間"
                value={state.motionBlend}
                min={0.04}
                max={0.8}
                onChange={(v) => {
                  state.motionBlend = v;
                }}
              />
              <Control
                label="ループ補間"
                value={state.loopBlend}
                min={0}
                max={0.8}
                onChange={(v) => {
                  state.loopBlend = v;
                }}
              />
            </div>
          </TabsContent>
          <TabsContent value="life" className="m-0 h-[calc(100%-48px)]">
            <ScrollArea className="h-full p-4">
              <div className="space-y-5">
                <h2 className="text-sm font-medium">生命感</h2>
                <Toggle
                  label="有効"
                  checked={state.lifeSettings.enabled}
                  onChange={(v) => {
                    state.lifeSettings.enabled = v;
                    redraw((n) => n + 1);
                  }}
                />
                <div className="grid grid-cols-3 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      Object.assign(state.lifeSettings, {
                        blinkActivity: 0.34,
                        gazeActivity: 0.28,
                        breathRate: 11,
                        sway: 0.14,
                      })
                    }
                  >
                    落ち着き
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      Object.assign(state.lifeSettings, {
                        blinkActivity: 0.52,
                        gazeActivity: 0.48,
                        breathRate: 14,
                        sway: 0.22,
                      })
                    }
                  >
                    自然
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      Object.assign(state.lifeSettings, {
                        blinkActivity: 0.38,
                        gazeActivity: 0.78,
                        breathRate: 18,
                        sway: 0.16,
                      })
                    }
                  >
                    活発
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    state.models.forEach((m) =>
                      forceBlink(m.life, m.motion, "full"),
                    )
                  }
                >
                  瞬きテスト
                </Button>
                {(
                  [
                    "blinkActivity",
                    "blinkStrength",
                    "blinkDuration",
                    "softBlinkChance",
                    "doubleBlinkChance",
                    "blinkOnGaze",
                    "gazeActivity",
                    "gazeRange",
                    "gazeDwell",
                    "microSaccade",
                    "headFollow",
                    "breathDepth",
                    "breathVariation",
                    "sway",
                    "swaySpeed",
                    "swayIrregularity",
                    "inertiaResponse",
                    "postureRecovery",
                  ] as const
                ).map((key) => (
                  <Control
                    key={key}
                    label={key}
                    value={state.lifeSettings[key]}
                    min={0}
                    max={1}
                    onChange={(v) => {
                      state.lifeSettings[key] = v;
                    }}
                  />
                ))}
                <Control
                  label="呼吸数"
                  value={state.lifeSettings.breathRate}
                  min={6}
                  max={28}
                  step={0.5}
                  onChange={(v) => {
                    state.lifeSettings.breathRate = v;
                  }}
                />
                <Toggle
                  label="ポインターを見る"
                  checked={state.lifeSettings.followPointer}
                  onChange={(v) => {
                    state.lifeSettings.followPointer = v;
                  }}
                />
                <h3 className="border-t pt-4 text-xs font-medium">
                  揺れの部位分布
                </h3>
                {Object.entries(state.lifeSettings.segments).map(
                  ([region, value]) => (
                    <Control
                      key={region}
                      label={region}
                      value={value}
                      min={0}
                      max={1}
                      onChange={(v) => {
                        state.lifeSettings.segments[
                          region as keyof typeof state.lifeSettings.segments
                        ] = v;
                      }}
                    />
                  ),
                )}
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="physics" className="m-0 h-[calc(100%-48px)]">
            <ScrollArea className="h-full p-4">
              <div className="space-y-5">
                <h2 className="text-sm font-medium">物理</h2>
                <Toggle
                  label="有効"
                  checked={state.physics}
                  onChange={(v) => {
                    state.physics = v;
                    if (v)
                      void Promise.all(state.models.map(enablePhysics)).finally(
                        () => redraw((n) => n + 1),
                      );
                    else {
                      state.models.forEach(disablePhysics);
                      redraw((n) => n + 1);
                    }
                  }}
                />
                <Button size="sm" variant="outline" onClick={resetAllPhysics}>
                  物理をリセット
                </Button>
                {(
                  [
                    "quality",
                    "stiffness",
                    "damping",
                    "gravity",
                    "wind",
                    "turbulence",
                    "air",
                  ] as const
                ).map((key) => (
                  <Control
                    key={key}
                    label={key}
                    value={state.physicsSettings[key]}
                    min={key === "quality" ? 1 : 0}
                    max={
                      key === "quality"
                        ? 4
                        : key === "wind"
                          ? 30
                          : key === "gravity"
                            ? 2
                            : 1
                    }
                    step={key === "quality" ? 1 : 0.01}
                    onChange={(v) => physics(key, v)}
                  />
                ))}
                <h3 className="border-t pt-4 text-xs font-medium">直接操作</h3>
                <div className="grid grid-cols-2 gap-1">
                  <Button
                    size="sm"
                    variant={
                      state.interactionSettings.mode === "select"
                        ? "secondary"
                        : "outline"
                    }
                    onClick={() => setInteractionMode("select")}
                  >
                    選択
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      state.interactionSettings.mode === "move"
                        ? "secondary"
                        : "outline"
                    }
                    onClick={() => setInteractionMode("move")}
                  >
                    移動
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      state.interactionSettings.mode === "poke"
                        ? "secondary"
                        : "outline"
                    }
                    onClick={() => setInteractionMode("poke")}
                  >
                    押す
                  </Button>
                </div>
                <Toggle
                  label="床面に固定"
                  checked={state.interactionSettings.groundLock}
                  onChange={(v) => {
                    state.interactionSettings.groundLock = v;
                  }}
                />
                <Control
                  label="モデル移動の追従"
                  value={state.interactionSettings.dragResponse}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => {
                    state.interactionSettings.dragResponse = v;
                  }}
                />
                <Control
                  label="衝撃波の強さ"
                  value={state.interactionSettings.pokeStrength}
                  min={0}
                  max={50}
                  step={0.01}
                  onChange={(v) => {
                    state.interactionSettings.pokeStrength = v;
                  }}
                />
                <Control
                  label="衝撃波の範囲"
                  value={state.interactionSettings.pokeRadius}
                  min={0.05}
                  max={3}
                  step={0.01}
                  onChange={(v) => {
                    state.interactionSettings.pokeRadius = v;
                  }}
                />
                <Control
                  label="衝撃波の速さ"
                  value={state.interactionSettings.shockwaveSpeed}
                  min={0.2}
                  max={4}
                  step={0.05}
                  onChange={(v) => {
                    state.interactionSettings.shockwaveSpeed = v;
                  }}
                />
                <h3 className="border-t pt-4 text-xs font-medium">
                  部位別設定
                </h3>
                {PHYSICS_PARTS.map((part) => (
                  <section className="space-y-3 rounded border p-2" key={part}>
                    <Toggle
                      label={part}
                      checked={state.physicsSettings.parts[part].enabled}
                      onChange={(v) => {
                        state.physicsSettings.parts[part].enabled = v;
                        state.models.forEach(applyPhysicsSettings);
                      }}
                    />
                    {(["response", "damping", "gravity", "wind"] as const).map(
                      (key) => (
                        <Control
                          key={key}
                          label={key}
                          value={state.physicsSettings.parts[part][key]}
                          min={0}
                          max={
                            key === "gravity" ? 2 : key === "response" ? 1.5 : 1
                          }
                          onChange={(v) => {
                            state.physicsSettings.parts[part][key] = v;
                            state.models.forEach(applyPhysicsSettings);
                          }}
                        />
                      ),
                    )}
                  </section>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="morph" className="m-0 h-[calc(100%-48px)]">
            <ScrollArea className="h-full p-4">
              <div className="space-y-3">
                <h2 className="text-sm font-medium">モーフ</h2>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      morphMeshes(state.active?.mesh).forEach((mesh) =>
                        mesh.morphTargetInfluences?.fill(0),
                      );
                      redraw((n) => n + 1);
                    }}
                  >
                    モーフをリセット
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (state.active)
                        eachMaterial(state.active.mesh, (material) => {
                          material.visible = true;
                        });
                      redraw((n) => n + 1);
                    }}
                  >
                    材質を全表示
                  </Button>
                </div>
                <input
                  type="search"
                  value={morphQuery}
                  onChange={(event) => setMorphQuery(event.target.value)}
                  placeholder="モーフ名を検索"
                  aria-label="モーフ名を検索"
                  className="h-8 w-full rounded-md border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
                {morphMeshes(state.active?.mesh).flatMap((mesh: any) =>
                  Object.entries(mesh.morphTargetDictionary ?? {})
                    .filter(([name]) => matchesQuery(name, morphQuery))
                    .map(
                    ([name, index]) => (
                      <Control
                        key={`${mesh.uuid}-${name}`}
                        label={name}
                        value={mesh.morphTargetInfluences[index as number] ?? 0}
                        min={0}
                        max={1}
                        onChange={(v) => {
                          mesh.morphTargetInfluences[index as number] = v;
                        }}
                      />
                    ),
                  ),
                )}
                <h3 className="border-t pt-4 text-xs font-medium">
                  マテリアル
                </h3>
                <input
                  type="search"
                  value={materialQuery}
                  onChange={(event) => setMaterialQuery(event.target.value)}
                  placeholder="材質名を検索"
                  aria-label="材質名を検索"
                  className="h-8 w-full rounded-md border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
                {state.active &&
                  (() => {
                    const entries: any[] = [];
                    eachMaterial(state.active.mesh, (material) =>
                      entries.push(material),
                    );
                    return entries
                      .filter((material, index) =>
                        matchesQuery(
                          material.name || `材質 ${index + 1}`,
                          materialQuery,
                        ),
                      )
                      .map((material, index) => (
                      <Toggle
                        key={`${material.uuid}-${index}`}
                        label={material.name || `材質 ${index + 1}`}
                        checked={material.visible !== false}
                        onChange={(v) => {
                          material.visible = v;
                          redraw((n) => n + 1);
                        }}
                      />
                    ));
                  })()}
                {!state.active && (
                  <p className="text-xs text-muted-foreground">
                    シーン内のモデルを選択してください。
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
        <div
          role="separator"
          aria-orientation="vertical"
          className="absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize touch-none hover:bg-primary/30"
          onPointerDown={(event) => beginResize("right", event)}
        />
      </aside>
    </main>
  );
}
