export class AiService {
    static worker: Worker | null = null;
    static callbacks: Record<string, { resolve: Function, reject: Function }> = {};
    static idCounter = 0;
    static isReady = false;

    static init() {
        if (this.worker) return;
        this.worker = new Worker(new URL('./AiWorker.ts', import.meta.url), { type: 'module' });
        
        this.worker.onmessage = (event) => {
            const { status, id, result, error, progress } = event.data;
            if (status === 'complete' && id != null) {
                if (this.callbacks[id]) {
                    this.callbacks[id].resolve(result);
                    delete this.callbacks[id];
                }
            } else if (status === 'error' && id != null) {
                if (this.callbacks[id]) {
                    this.callbacks[id].reject(new Error(error));
                    delete this.callbacks[id];
                }
            } else if (status === 'progress') {
                // handle download progress
                console.log('AI Model Progress:', progress);
            }
        };
    }

    static async embed(text: string): Promise<number[]> {
        this.init();
        const id = (this.idCounter++).toString();
        return new Promise((resolve, reject) => {
            this.callbacks[id] = { resolve, reject };
            this.worker?.postMessage({ action: 'embed', payload: { text }, id });
        });
    }

    static async summarize(text: string): Promise<string> {
        this.init();
        const id = (this.idCounter++).toString();
        return new Promise((resolve, reject) => {
            this.callbacks[id] = { resolve, reject };
            this.worker?.postMessage({ action: 'summarize', payload: { text }, id });
        });
    }

    static dotProduct(a: number[], b: number[]): number {
        return a.reduce((sum, val, i) => sum + val * b[i], 0);
    }
}
