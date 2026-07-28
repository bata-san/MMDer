import { Eye, EyeOff, FolderOpen, MousePointer2, Move3d, Rotate3d, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { morphMeshes } from './motion';
import { arrangeModels, clearModelSelection, focusModel, removeModel, selectAllModels, setActiveModel } from './models';
import { applyPhysicsSettings, PHYSICS_PART_LABELS, PHYSICS_PARTS } from './physics';
import { click, clickSelector, setChecked, setValue } from './runtime-bridge';
import { state } from './state';

type Range = { id: string; label: string; value: number; min: number; max: number; step: number };
const tools = [{ icon: MousePointer2, mode: 'select', label: 'Select' }, { icon: Move3d, mode: 'move', label: 'Move' }, { icon: Rotate3d, mode: 'poke', label: 'Poke' }];

function RangeControl({ control }: { control: Range }) {
  const [value, setLocalValue] = useState(control.value);
  return <div className="space-y-2">
    <div className="flex justify-between text-xs"><span>{control.label}</span><output className="tabular-nums text-muted-foreground">{value}</output></div>
    <Slider value={[value]} min={control.min} max={control.max} step={control.step} onValueChange={([next]) => { setLocalValue(next); setValue(control.id, next); }} />
  </div>;
}

function Ranges({ controls }: { controls: Range[] }) {
  return <div className="space-y-5">{controls.map((control) => <RangeControl control={control} key={control.id} />)}</div>;
}

function MorphPanel() {
  const [, redraw] = useState(0);
  const mesh = morphMeshes(state.active?.mesh)[0];
  const entries = mesh ? Object.entries(mesh.morphTargetDictionary as Record<string, number>).slice(0, 120) : [];
  return <ScrollArea className="h-[calc(100vh-92px)] p-4"><div className="space-y-5">
    <Button variant="outline" size="sm" onClick={() => click('reset-morph')}>Reset all morphs</Button>
    {!entries.length && <p className="text-xs text-muted-foreground">Select a model to edit morphs.</p>}
    {entries.map(([name, index]) => <div key={name} className="space-y-2"><div className="flex justify-between text-xs"><span>{name}</span><output>{Math.round(Number(mesh.morphTargetInfluences[index] ?? 0) * 100)}%</output></div><Slider value={[Number(mesh.morphTargetInfluences[index] ?? 0) * 100]} max={100} step={1} onValueChange={([next]) => { morphMeshes(state.active?.mesh).forEach((item: any) => { item.morphTargetInfluences[index] = next / 100; }); redraw((value) => value + 1); }} /></div>)}
  </div></ScrollArea>;
}

function MaterialsPanel() {
  const [, redraw] = useState(0);
  const materials: any[] = [];
  state.active?.mesh.traverse((mesh: any) => {
    if (mesh.isMesh && mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material: any) => materials.push(material));
  });
  return <ScrollArea className="h-[calc(100vh-92px)] p-4"><div className="space-y-3">
    <Button variant="outline" size="sm" onClick={() => click('show-all-materials')}>Show all</Button>
    {!materials.length && <p className="text-xs text-muted-foreground">Select a model to edit materials.</p>}
    {materials.map((material, index) => <div className="flex items-center justify-between gap-3 text-xs" key={`${material.uuid}-${index}`}><span className="truncate">{material.name || `Material ${index + 1}`}</span><Switch checked={material.visible !== false} onCheckedChange={(checked) => { material.visible = checked; redraw((value) => value + 1); }} /></div>)}
  </div></ScrollArea>;
}

function PhysicsPartsPanel() {
  const [, redraw] = useState(0);
  const update = (part: typeof PHYSICS_PARTS[number], key: 'response' | 'damping' | 'gravity' | 'wind', value: number) => {
    state.physicsSettings.parts[part][key] = value;
    state.models.forEach((model) => applyPhysicsSettings(model));
    redraw((current) => current + 1);
  };
  return <div className="space-y-5 border-t pt-5"><h3 className="text-xs font-medium">Physics parts</h3>{PHYSICS_PARTS.map((part) => {
    const value = state.physicsSettings.parts[part];
    return <section className="space-y-3 rounded-md border p-3" key={part}><div className="flex items-center justify-between text-xs"><span>{PHYSICS_PART_LABELS[part]}</span><Switch checked={value.enabled} onCheckedChange={(checked) => { value.enabled = checked; state.models.forEach((model) => applyPhysicsSettings(model)); redraw((current) => current + 1); }} /></div>{(['response', 'damping', 'gravity', 'wind'] as const).map((key) => <div className="space-y-1" key={key}><div className="flex justify-between text-[11px]"><span className="capitalize">{key}</span><span>{value[key].toFixed(2)}</span></div><Slider value={[value[key]]} min={0} max={key === 'gravity' ? 2 : key === 'response' ? 1.5 : 1} step={.01} onValueChange={([next]) => update(part, key, next)} /></div>)}</section>;
  })}</div>;
}

function SwayPartsPanel() {
  const [, redraw] = useState(0);
  return <div className="space-y-4 border-t pt-5"><h3 className="text-xs font-medium">Sway distribution</h3>{Object.entries(state.lifeSettings.segments).map(([region, value]) => <div className="space-y-1" key={region}><div className="flex justify-between text-[11px]"><span>{region}</span><span>{value.toFixed(2)}</span></div><Slider value={[value]} min={0} max={1} step={.01} onValueChange={([next]) => { state.lifeSettings.segments[region as keyof typeof state.lifeSettings.segments] = next; redraw((current) => current + 1); }} /></div>)}</div>;
}

function ScenePanel() {
  const [, redraw] = useState(0);
  return <ScrollArea className="h-[calc(100vh-92px)] p-3"><div className="space-y-1">
    {state.models.map((model) => <div key={model.id} className={`flex items-center gap-1 rounded-md px-1 ${state.active === model ? 'bg-muted' : ''}`}>
      <Button variant="ghost" className="h-8 flex-1 justify-start truncate px-2 text-xs" onDoubleClick={() => focusModel(model)} onClick={() => setActiveModel(model)}>{model.name}</Button>
      <Button variant="ghost" size="icon" className="size-8" onClick={() => { model.visible = !model.visible; model.mesh.visible = model.visible; redraw((value) => value + 1); }}>{model.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}</Button>
      <Button variant="ghost" size="icon" className="size-8" onClick={() => removeModel(model)}><Trash2 className="size-3" /></Button>
    </div>)}
    {!state.models.length && <p className="px-3 pt-8 text-center text-xs text-muted-foreground">No models in this scene.</p>}
  </div></ScrollArea>;
}

export function Editor() {
  const [, redraw] = useState(0);
  const [dark, setDark] = useState(false);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => { const timer = window.setInterval(() => redraw((value) => value + 1), 500); return () => window.clearInterval(timer); }, []);
  const view: Range[] = [{ id: 'fov', label: 'Field of view', value: 38, min: 20, max: 90, step: 1 }, { id: 'exposure', label: 'Exposure', value: 1, min: .4, max: 2, step: .1 }, { id: 'outline', label: 'Outline', value: .28, min: 0, max: 1.5, step: .05 }, { id: 'env-intensity', label: 'Environment', value: .65, min: 0, max: 2, step: .05 }, { id: 'specular', label: 'Specular', value: .16, min: 0, max: 1, step: .01 }, { id: 'shadow-lift', label: 'Shadow lift', value: .04, min: 0, max: .4, step: .01 }];
  const motion: Range[] = [{ id: 'timeline', label: 'Timeline', value: 0, min: 0, max: 1, step: .001 }, { id: 'motion-blend', label: 'Crossfade', value: .22, min: .04, max: .8, step: .01 }, { id: 'loop-blend', label: 'Loop blend', value: .38, min: 0, max: .8, step: .01 }];
  const life: Range[] = [{ id: 'blink-activity', label: 'Blink activity', value: .52, min: 0, max: 1, step: .01 }, { id: 'blink-duration', label: 'Blink speed', value: 1, min: 0, max: 1, step: .01 }, { id: 'blink-strength', label: 'Blink strength', value: .94, min: 0, max: 1, step: .01 }, { id: 'blink-on-gaze', label: 'Blink on gaze', value: .35, min: 0, max: 1, step: .01 }, { id: 'gaze-range', label: 'Gaze range', value: .42, min: 0, max: 1, step: .01 }, { id: 'head-follow', label: 'Head follow', value: .24, min: 0, max: 1, step: .01 }, { id: 'breath-rate', label: 'Breath rate', value: 14, min: 6, max: 28, step: .5 }, { id: 'breath-depth', label: 'Breath depth', value: .24, min: 0, max: 1, step: .01 }, { id: 'sway', label: 'Sway', value: .22, min: 0, max: 1, step: .01 }, { id: 'soft-blink', label: 'Soft blink', value: .22, min: 0, max: .6, step: .01 }, { id: 'double-blink', label: 'Double blink', value: .12, min: 0, max: .5, step: .01 }, { id: 'gaze-activity', label: 'Gaze activity', value: .48, min: 0, max: 1, step: .01 }, { id: 'gaze-dwell', label: 'Gaze dwell', value: .55, min: 0, max: 1, step: .01 }, { id: 'micro-saccade', label: 'Micro saccade', value: .26, min: 0, max: 1, step: .01 }, { id: 'breath-variation', label: 'Breath variation', value: .16, min: 0, max: 1, step: .01 }, { id: 'sway-speed', label: 'Sway speed', value: .44, min: 0, max: 1, step: .01 }, { id: 'sway-irregularity', label: 'Sway irregularity', value: .32, min: 0, max: 1, step: .01 }];
  const physics: Range[] = [{ id: 'physics-quality', label: 'Quality', value: 3, min: 1, max: 4, step: 1 }, { id: 'stiffness', label: 'Stiffness', value: .62, min: 0, max: 1, step: .01 }, { id: 'damping', label: 'Damping', value: .18, min: 0, max: 1, step: .01 }, { id: 'gravity', label: 'Gravity', value: 1, min: 0, max: 2, step: .05 }, { id: 'wind', label: 'Wind', value: 0, min: 0, max: 30, step: .5 }, { id: 'turbulence', label: 'Turbulence', value: 0, min: 0, max: 1, step: .01 }, { id: 'air', label: 'Air resistance', value: .28, min: 0, max: 1, step: .01 }, { id: 'drag-response', label: 'Drag response', value: .72, min: 0, max: 1, step: .01 }, { id: 'poke-strength', label: 'Poke strength', value: 1.2, min: .1, max: 5, step: .1 }, { id: 'poke-radius', label: 'Poke radius', value: .85, min: .2, max: 2, step: .05 }, { id: 'pull-strength', label: 'Pull strength', value: 18, min: 2, max: 50, step: 1 }, { id: 'pull-damping', label: 'Pull damping', value: 3.5, min: 0, max: 12, step: .5 }, { id: 'pull-radius', label: 'Pull radius', value: 1.2, min: .2, max: 2.5, step: .05 }];
  return <main className="grid h-screen grid-cols-[60px_240px_minmax(0,1fr)_340px] grid-rows-[48px_minmax(0,1fr)] bg-background text-foreground">
    <header className="col-span-4 flex items-center gap-3 border-b px-3"><div className="size-3 rounded-sm bg-foreground" /><span className="text-sm font-medium">Untitled scene</span><span className="text-xs text-muted-foreground">{state.models.length} models · local</span><div className="ml-auto flex gap-2"><Button size="sm" variant="ghost" onClick={() => setDark((value) => !value)}>{dark ? 'Light' : 'Dark'}</Button><Button size="sm" variant="outline" onClick={() => click('open-models')}>Import model</Button><Button size="sm" onClick={() => click('open-motions')}>Add motion</Button></div></header>
    <nav className="flex flex-col items-center gap-2 border-r py-3" aria-label="Tools">{tools.map(({ icon: Icon, mode, label }, index) => <Button key={mode} title={label} variant={index === 0 ? 'secondary' : 'ghost'} size="icon" onClick={() => setValue('interaction-mode', mode)}><Icon className="size-4" /></Button>)}</nav>
    <aside className="border-r"><div className="flex h-11 items-center justify-between border-b px-3 text-xs font-medium"><span>Assets</span><Button variant="ghost" size="icon" onClick={() => click('open-folder')}><FolderOpen className="size-4" /></Button></div><ScrollArea className="h-[calc(100vh-92px)] p-3"><div className="space-y-3"><Button variant="outline" className="w-full justify-start" onClick={() => click('open-models')}><FolderOpen className="size-4" /> Add model</Button><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={selectAllModels}>Select all</Button><Button size="sm" variant="ghost" onClick={clearModelSelection}>Clear</Button><Button size="sm" variant="ghost" onClick={arrangeModels}>Arrange</Button></div><ScenePanel /></div></ScrollArea></aside>
    <section id="viewport-canvas" className="relative grid place-items-center overflow-hidden bg-muted/30"><div className="pointer-events-none absolute inset-0 opacity-50 [background-image:radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:24px_24px]" />{!state.models.length && <div className="relative text-center"><h1 className="text-sm font-medium">Viewport</h1><p className="mt-1 text-xs text-muted-foreground">Import a model to begin editing</p></div>}<div className="absolute bottom-3 left-3 rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground">Perspective · 60 FPS</div></section>
    <aside className="border-l"><Tabs defaultValue="view" className="h-full"><TabsList className="h-11 w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-1"><TabsTrigger value="view">View</TabsTrigger><TabsTrigger value="motion">Motion</TabsTrigger><TabsTrigger value="life">Life</TabsTrigger><TabsTrigger value="physics">Physics</TabsTrigger><TabsTrigger value="morph">Morph</TabsTrigger><TabsTrigger value="materials">Materials</TabsTrigger></TabsList>
      <TabsContent value="view" className="m-0"><ScrollArea className="h-[calc(100vh-92px)] p-4"><div className="space-y-6"><div className="grid grid-cols-3 gap-1"><Button size="sm" variant="outline" onClick={() => clickSelector('[data-camera="front"]')}>Front</Button><Button size="sm" variant="outline" onClick={() => clickSelector('[data-camera="threequarter"]')}>Angle</Button><Button size="sm" variant="outline" onClick={() => clickSelector('[data-camera="wide"]')}>Wide</Button></div><Ranges controls={view} /><div className="space-y-3 border-t pt-5">{[['grid', 'Grid', true], ['shadows', 'Shadows', true], ['toon-outline', 'Outline', true], ['show-hdri', 'HDR background', false], ['rig-edit', 'Rig editing', false]].map(([id, label, checked]) => <div key={String(id)} className="flex items-center justify-between text-xs"><span>{label}</span><Switch defaultChecked={Boolean(checked)} onCheckedChange={(next) => setChecked(String(id), next)} /></div>)}</div><Button size="sm" variant="outline" onClick={() => click('open-hdri')}>Choose HDR</Button></div></ScrollArea></TabsContent>
      <TabsContent value="motion" className="m-0"><ScrollArea className="h-[calc(100vh-92px)] p-4"><div className="space-y-5"><div className="flex gap-2"><Button size="sm" onClick={() => click('play')}>Play / pause</Button><Button size="sm" variant="outline" onClick={() => click('restart-motion')}>Restart</Button><Button size="sm" variant="outline" onClick={() => click('sync-motion')}>Sync</Button></div><div className="flex items-center justify-between text-xs"><span>Loop</span><Switch defaultChecked onCheckedChange={() => click('loop')} /></div><Select defaultValue="selected" onValueChange={(value) => setValue('motion-scope', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active model</SelectItem><SelectItem value="selected">Selected models</SelectItem><SelectItem value="all">All models</SelectItem></SelectContent></Select><Ranges controls={motion} /></div></ScrollArea></TabsContent>
      <TabsContent value="life" className="m-0"><ScrollArea className="h-[calc(100vh-92px)] p-4"><div className="space-y-5"><div className="flex items-center justify-between text-xs"><span>Enable life</span><Switch defaultChecked onCheckedChange={(next) => setChecked('life-enabled', next)} /></div><div className="grid grid-cols-3 gap-1"><Button size="sm" variant="outline" onClick={() => clickSelector('[data-life-preset="calm"]')}>Calm</Button><Button size="sm" variant="outline" onClick={() => clickSelector('[data-life-preset="natural"]')}>Natural</Button><Button size="sm" variant="outline" onClick={() => clickSelector('[data-life-preset="alert"]')}>Alert</Button></div><div className="flex items-center justify-between text-xs"><span>Follow pointer</span><Switch onCheckedChange={(next) => setChecked('follow-pointer', next)} /></div><Button size="sm" variant="outline" onClick={() => click('test-blink')}>Test blink</Button><Ranges controls={life} /><SwayPartsPanel /></div></ScrollArea></TabsContent>
      <TabsContent value="physics" className="m-0"><ScrollArea className="h-[calc(100vh-92px)] p-4"><div className="space-y-5"><div className="flex items-center justify-between text-xs"><span>Enable physics</span><Switch onCheckedChange={(next) => setChecked('physics', next)} /></div><div className="flex items-center justify-between text-xs"><span>Keep on ground</span><Switch defaultChecked onCheckedChange={(next) => setChecked('ground-lock', next)} /></div><Select defaultValue="select" onValueChange={(value) => setValue('interaction-mode', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="select">Select</SelectItem><SelectItem value="move">Move</SelectItem><SelectItem value="poke">Poke</SelectItem><SelectItem value="pull">Pull</SelectItem></SelectContent></Select><Ranges controls={physics} /><Button size="sm" variant="outline" onClick={() => click('physics-reset')}>Reset physics</Button><PhysicsPartsPanel /></div></ScrollArea></TabsContent>
      <TabsContent value="morph" className="m-0"><MorphPanel /></TabsContent><TabsContent value="materials" className="m-0"><MaterialsPanel /></TabsContent>
    </Tabs></aside>
  </main>;
}

