let parserModulePromise = null;
function parserModule() {
    parserModulePromise ??= import('https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/libs/mmdparser.module.js');
    return parserModulePromise;
}
function transferableBuffers(value, output = new Set(), visited = new Set()) {
    if (!value || typeof value !== 'object')
        return output;
    if (value instanceof ArrayBuffer) {
        output.add(value);
        return output;
    }
    if (ArrayBuffer.isView(value)) {
        if (value.buffer instanceof ArrayBuffer)
            output.add(value.buffer);
        return output;
    }
    if (visited.has(value))
        return output;
    visited.add(value);
    if (Array.isArray(value)) {
        value.forEach((item) => transferableBuffers(item, output, visited));
    }
    else {
        Object.values(value).forEach((item) => transferableBuffers(item, output, visited));
    }
    return output;
}
async function unzip(buffer) {
    const { unzipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js');
    const archive = unzipSync(new Uint8Array(buffer));
    const entries = [];
    const transfer = [];
    Object.entries(archive).forEach(([path, data]) => {
        if (!data.byteLength || path.endsWith('/'))
            return;
        const copy = data.slice().buffer;
        entries.push({ path, buffer: copy });
        transfer.push(copy);
    });
    return { entries, transfer };
}
async function parseModel(buffer) {
    const { MMDParser } = await parserModule();
    const signature = new TextDecoder('utf-8').decode(new Uint8Array(buffer, 0, Math.min(3, buffer.byteLength))).toLowerCase();
    const format = signature === 'pmd' ? 'pmd' : signature === 'pmx' ? 'pmx' : null;
    if (!format)
        throw new Error(`Unknown MMD model signature: ${signature || 'empty file'}`);
    const parser = new MMDParser.Parser();
    const data = format === 'pmd' ? parser.parsePmd(buffer, true) : parser.parsePmx(buffer, true);
    return { result: { format, data }, transfer: [...transferableBuffers(data)] };
}
self.onmessage = async (event) => {
    const { id, kind, buffer } = event.data;
    try {
        if (kind === 'warm-model-parser') {
            await parserModule();
            self.postMessage({ id, ok: true, result: true });
            return;
        }
        if (!buffer)
            throw new Error('Missing transferable buffer.');
        if (kind === 'unzip') {
            const { entries, transfer } = await unzip(buffer);
            self.postMessage({ id, ok: true, result: entries }, transfer);
            return;
        }
        const { result, transfer } = await parseModel(buffer);
        self.postMessage({ id, ok: true, result }, transfer);
    }
    catch (error) {
        self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
};
