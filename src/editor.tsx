import { Clapperboard, FolderOpen, Monitor, Move3d, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Play, Rotate3d, Smile, Sparkles, Wind } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { importAssets } from './assets';
import { forceBlink } from './life';
import { synchronizeMotions, seekMotions } from './motion';
import { arrangeModels, clearModelSelection, clearModels, selectAllModels } from './models';
import { resetAllPhysics } from './physics';
import { state } from './state';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const tabs = [
  ['view', '表示', Monitor], ['motion', 'モーション', Clapperboard], ['life', '生命感', Sparkles], ['physics', '物理', Wind], ['morph', 'モーフ', Smile],
] as const;

function FileInput({ inputRef, accept, folder, onFiles }: { inputRef: React.RefObject<HTMLInputElement | null>; accept?: string; folder?: boolean; onFiles: (files: FileList | null) => void }) {
  return <input ref={inputRef} className="hidden" type="file" multiple accept={accept} onChange={(event) => onFiles(event.currentTarget.files)} {...(folder ? { webkitdirectory: '' } as any : {})} />;
}

export function Editor() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [dark, setDark] = useState(false);
  const [, redraw] = useState(0);
  const folder = useRef<HTMLInputElement>(null);
  const motion = useRef<HTMLInputElement>(null);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => { const id = window.setInterval(() => redraw((n) => n + 1), 500); return () => clearInterval(id); }, []);
  const load = (files: FileList | null, models: boolean) => { if (files?.length) void importAssets(files, models); };
  const grid = `56px ${leftOpen ? '240px' : '0px'} minmax(0,1fr) ${rightOpen ? '340px' : '0px'}`;
  return <main className="grid h-screen grid-rows-[48px_minmax(0,1fr)] bg-background text-foreground" style={{ gridTemplateColumns: grid }}>
    <FileInput inputRef={folder} folder onFiles={(files) => load(files, true)} />
    <FileInput inputRef={motion} accept=".vmd,.vpd" onFiles={(files) => load(files, false)} />
    <header className="col-span-4 flex items-center gap-3 border-b px-3"><span className="size-3 rounded-sm bg-foreground" /><span className="text-sm font-medium">無題のシーン</span><span className="text-xs text-muted-foreground">{state.models.length} モデル</span><div className="ml-auto flex gap-1"><Button size="icon" variant="ghost" onClick={() => setLeftOpen(!leftOpen)}>{leftOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</Button><Button size="icon" variant="ghost" onClick={() => setRightOpen(!rightOpen)}>{rightOpen ? <PanelRightClose /> : <PanelRightOpen />}</Button><Button size="sm" variant="ghost" onClick={() => setDark(!dark)}>{dark ? 'ライト' : 'ダーク'}</Button><Button size="sm" variant="outline" onClick={() => folder.current?.click()}><FolderOpen />フォルダを追加</Button><Button size="sm" onClick={() => motion.current?.click()}>モーション追加</Button></div></header>
    <nav className="flex flex-col items-center gap-2 border-r py-3"><Button size="icon" variant="secondary"><Move3d /></Button><Button size="icon" variant="ghost"><Rotate3d /></Button></nav>
    <aside className="overflow-hidden border-r"><div className="flex h-11 items-center justify-between border-b px-3 text-xs font-medium"><span>アセット</span><Button size="sm" variant="ghost" onClick={() => clearModels()}>すべて削除</Button></div><div className="space-y-3 p-3"><Button className="w-full" variant="outline" onClick={() => folder.current?.click()}><FolderOpen />フォルダを追加</Button><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={selectAllModels}>全選択</Button><Button size="sm" variant="ghost" onClick={clearModelSelection}>解除</Button><Button size="sm" variant="ghost" onClick={arrangeModels}>整列</Button></div><div className="space-y-1">{state.models.map((model) => <div className="truncate rounded-md bg-muted px-2 py-2 text-xs" key={model.id}>{model.name}</div>)}{!state.models.length && <p className="pt-8 text-center text-xs text-muted-foreground">フォルダを追加して開始</p>}</div></div></aside>
    <section id="viewport-canvas" className="relative overflow-hidden bg-muted/30"><div className="pointer-events-none absolute inset-0 opacity-50 [background-image:radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:24px_24px]" /><div className="pointer-events-none absolute bottom-3 left-3 rounded border bg-background px-2 py-1 text-[11px] text-muted-foreground">パースペクティブ</div></section>
    <aside className="min-w-0 overflow-hidden border-l"><Tabs defaultValue="view" className="h-full"><TabsList className="grid h-12 w-full grid-cols-5 gap-0 rounded-none border-b bg-transparent p-1">{tabs.map(([id, label, Icon]) => <TabsTrigger key={id} value={id} title={label} aria-label={label} className="min-w-0 px-0"><Icon className="size-4" /><span className="sr-only">{label}</span></TabsTrigger>)}</TabsList>
      <TabsContent value="view" className="space-y-5 p-4"><p className="text-sm font-medium">表示</p><label className="flex items-center justify-between text-xs">グリッド <Switch defaultChecked /></label><label className="flex items-center justify-between text-xs">影 <Switch defaultChecked /></label><label className="flex items-center justify-between text-xs">輪郭線 <Switch defaultChecked /></label></TabsContent>
      <TabsContent value="motion" className="space-y-5 p-4"><p className="text-sm font-medium">モーション</p><div className="flex gap-2"><Button size="sm" onClick={() => { state.playing = !state.playing; }}><Play />再生</Button><Button size="sm" variant="outline" onClick={() => { state.elapsed = 0; synchronizeMotions(true); resetAllPhysics(); }}>最初から</Button></div><Slider value={[state.duration ? state.elapsed / state.duration : 0]} max={1} step={.001} onValueChange={([value]) => { if (state.duration) { state.elapsed = value * state.duration; seekMotions(state.elapsed); } }} /></TabsContent>
      <TabsContent value="life" className="space-y-5 p-4"><p className="text-sm font-medium">生命感</p><label className="flex items-center justify-between text-xs">有効 <Switch defaultChecked onCheckedChange={(enabled) => { state.lifeSettings.enabled = enabled; }} /></label><Button size="sm" variant="outline" onClick={() => state.models.forEach((model) => forceBlink(model.life, model.motion, 'full'))}>瞬きテスト</Button></TabsContent>
      <TabsContent value="physics" className="space-y-5 p-4"><p className="text-sm font-medium">物理</p><label className="flex items-center justify-between text-xs">有効 <Switch onCheckedChange={(enabled) => { state.physics = enabled; }} /></label><Button size="sm" variant="outline" onClick={resetAllPhysics}>物理をリセット</Button></TabsContent>
      <TabsContent value="morph" className="p-4 text-xs text-muted-foreground">モデルを選択するとモーフを編集できます。</TabsContent>
    </Tabs></aside>
  </main>;
}
