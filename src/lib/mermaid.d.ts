declare module 'mermaid/dist/mermaid.core.mjs' {
  interface MermaidRuntime {
    initialize(config: {
      startOnLoad?: boolean;
      securityLevel?: 'strict';
      htmlLabels?: boolean;
      suppressErrorRendering?: boolean;
      logLevel?: 'fatal';
      secure?: string[];
    }): void;
    render(id: string, text: string): Promise<{ svg: string }>;
  }

  const mermaid: MermaidRuntime;
  export default mermaid;
}
