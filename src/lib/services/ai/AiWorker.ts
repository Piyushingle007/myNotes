import { pipeline, env } from '@xenova/transformers';

// Disable local models since we are running in the browser and fetching from HuggingFace Hub
env.allowLocalModels = false;
env.useBrowserCache = true;

class PipelineFactory {
    static taskToPipeline: any = {};
    
    static async getInstance(task: string, model: string, progressCallback: any) {
        if (!this.taskToPipeline[task]) {
            this.taskToPipeline[task] = pipeline(task, model, {
                progress_callback: progressCallback
            });
        }
        return this.taskToPipeline[task];
    }
}

self.addEventListener('message', async (event) => {
    const { action, payload, id } = event.data;
    
    try {
        if (action === 'embed') {
            const embedder = await PipelineFactory.getInstance('feature-extraction', 'Xenova/all-MiniLM-L6-v2', (progress: any) => {
                self.postMessage({ status: 'progress', action, progress });
            });
            const output = await embedder(payload.text, { pooling: 'mean', normalize: true });
            self.postMessage({ status: 'complete', id, result: Array.from(output.data) });
        } 
        else if (action === 'summarize') {
            const summarizer = await PipelineFactory.getInstance('summarization', 'Xenova/distilbart-cnn-6-6', (progress: any) => {
                self.postMessage({ status: 'progress', action, progress });
            });
            const output = await summarizer(payload.text, {
                max_new_tokens: 100,
                min_length: 30,
            });
            self.postMessage({ status: 'complete', id, result: output[0].summary_text });
        }
    } catch (e: any) {
        self.postMessage({ status: 'error', id, error: e.message });
    }
});
