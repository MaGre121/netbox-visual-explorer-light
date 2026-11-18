import { instance } from "./vendor/viz.js";

const renderer = instance();
self.onmessage = async ({ data }) => {
    try {
        const viz = await renderer;
        self.postMessage({ svg: viz.renderString(data, { format: "svg" }) });
    } catch (error) {
        self.postMessage({ error: String(error) });
    }
};
