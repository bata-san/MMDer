import { $ } from './dom.js';
import { applyMotion, morphMeshes } from './motion.js';
import { focusModel, loadModel, removeModel, setActiveModel, toggleModelSelection } from './models.js';
import { removeStoredAsset } from './storage.js';
import { state } from './state.js';
function assetRow(asset, action) {
    const row = document.createElement('div');
    row.className = 'asset';
    const open = document.createElement('button');
    open.className = 'asset-open';
    open.innerHTML = `<span>＋</span><div><b>${asset.name}</b><small>${asset.path || asset.kind.toUpperCase()}</small></div>`;
    open.onclick = action;
    const remove = document.createElement('button');
    remove.className = 'asset-delete';
    remove.title = 'ライブラリから削除';
    remove.textContent = '×';
    remove.onclick = async () => {
        await removeStoredAsset(asset.id);
        renderLibraries();
    };
    row.append(open, remove);
    return row;
}
export function renderLibraries() {
    const draw = (kind, targetSelector, countSelector, emptyMessage, action) => {
        const assets = state.assets.filter((asset) => asset.kind === kind);
        $(countSelector).textContent = String(assets.length);
        const root = $(targetSelector);
        root.innerHTML = '';
        if (!assets.length) {
            root.innerHTML = `<div class="empty">${emptyMessage}</div>`;
            return;
        }
        assets.forEach((asset) => root.append(assetRow(asset, () => action(asset))));
    };
    draw('model', '#model-library', '#model-library-count', 'モデルを追加すると<br/>ここから再読み込みできます', (asset) => { void loadModel(asset.file); });
    draw('motion', '#motion-library', '#motion-library-count', 'モーションを追加すると<br/>選択モデルへ適用できます', (asset) => { void applyMotion(asset.file); });
}
export function renderSceneModels() {
    const root = $('#models');
    root.innerHTML = '';
    $('#selected-count').textContent = `${state.selectedModels.length} selected`;
    if (!state.models.length) {
        root.innerHTML = '<div class="empty">モデルを読み込むと<br/>ここに表示されます</div>';
        $('#model-count').textContent = '0 models';
        return;
    }
    state.models.forEach((model, index) => {
        const selected = state.selectedModels.includes(model);
        const row = document.createElement('div');
        row.className = `asset scene-model ${model === state.active ? 'active' : ''} ${selected ? 'selected' : ''}`;
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'model-select';
        check.checked = selected;
        check.title = '複数選択';
        check.onchange = () => toggleModelSelection(model, check.checked);
        const select = document.createElement('button');
        select.className = 'asset-open';
        select.innerHTML = `<span>${String(index + 1).padStart(2, '0')}</span><div><b>${model.name}</b><small>${model.motion.currentName || 'モーションなし'} · ${model.visible ? '表示中' : '非表示'}</small></div>`;
        select.onclick = (event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey) {
                toggleModelSelection(model, !state.selectedModels.includes(model));
            }
            else {
                setActiveModel(model);
            }
        };
        const visibility = document.createElement('button');
        visibility.className = 'scene-action';
        visibility.title = model.visible ? '非表示にする' : '表示する';
        visibility.textContent = model.visible ? '◉' : '○';
        visibility.onclick = () => {
            model.visible = !model.visible;
            model.mesh.visible = model.visible;
            renderSceneModels();
        };
        const focus = document.createElement('button');
        focus.className = 'scene-action';
        focus.title = 'このモデルにフォーカス';
        focus.textContent = '⌖';
        focus.onclick = () => focusModel(model);
        const remove = document.createElement('button');
        remove.className = 'scene-action danger';
        remove.title = 'シーンから削除';
        remove.textContent = '×';
        remove.onclick = () => removeModel(model);
        row.append(check, select, visibility, focus, remove);
        root.append(row);
    });
    $('#model-count').textContent = `${state.models.length} models`;
}
export function renderMorphs() {
    const root = $('#morphs');
    const meshes = morphMeshes(state.active?.mesh);
    root.innerHTML = '';
    if (!meshes.length) {
        root.innerHTML = '<div class="empty">モデルを選択すると<br/>モーフが表示されます</div>';
        return;
    }
    const groups = new Map();
    meshes.forEach((mesh) => {
        Object.entries(mesh.morphTargetDictionary).forEach(([name, index]) => {
            const bindings = groups.get(name) ?? [];
            bindings.push({ mesh, index });
            groups.set(name, bindings);
        });
    });
    [...groups.entries()].slice(0, 140).forEach(([name, bindings]) => {
        const value = bindings.reduce((sum, binding) => sum + Number(binding.mesh.morphTargetInfluences[binding.index] ?? 0), 0) / bindings.length;
        const row = document.createElement('div');
        row.className = 'parameter-row';
        row.innerHTML = `<label>${name}<output>${Math.round(value * 100)}%</output></label><input type="range" min="0" max="1" step=".01" value="${value}">`;
        const range = row.querySelector('input');
        const valueOutput = row.querySelector('output');
        range.oninput = () => {
            const next = Number(range.value);
            bindings.forEach((binding) => { binding.mesh.morphTargetInfluences[binding.index] = next; });
            valueOutput.textContent = `${Math.round(next * 100)}%`;
        };
        root.append(row);
    });
}
export function renderMaterials() {
    const root = $('#materials');
    root.innerHTML = '';
    if (!state.active) {
        root.innerHTML = '<div class="empty">モデルを選択すると<br/>マテリアルが表示されます</div>';
        return;
    }
    const entries = [];
    state.active.mesh.traverse((mesh) => {
        if (!mesh.isMesh || !mesh.material)
            return;
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => entries.push(material));
    });
    entries.forEach((material, index) => {
        const row = document.createElement('label');
        row.className = 'check';
        const label = material.name || material.map?.name || `Material ${String(index + 1).padStart(2, '0')}`;
        row.innerHTML = `<input type="checkbox" ${material.visible ? 'checked' : ''}><span>${label}</span>`;
        row.querySelector('input').onchange = (event) => {
            material.visible = event.currentTarget.checked;
        };
        root.append(row);
    });
    if (!entries.length)
        root.innerHTML = '<div class="empty">マテリアルが見つかりません</div>';
}
export function renderActivePanels() {
    renderSceneModels();
    renderMorphs();
    renderMaterials();
}
export function showAllMaterials() {
    state.active?.mesh.traverse((mesh) => {
        if (!mesh.isMesh || !mesh.material)
            return;
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => { material.visible = true; });
    });
    renderMaterials();
}
