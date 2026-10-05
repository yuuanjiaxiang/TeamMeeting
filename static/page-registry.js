// Modules own their data loader. The shell owns authentication and navigation.
export function createPageRegistry() {
  const modules = new Map();
  return {
    register(id, { load, references = async () => {} }) {
      if (modules.has(id)) throw new Error(`Duplicate page module: ${id}`);
      if (typeof load !== "function") throw new TypeError(`Missing loader: ${id}`);
      modules.set(id, { load, references });
    },
    async load(id, isCurrent = () => true) {
      const module = modules.get(id);
      if (!module) throw new Error(`Unknown page module: ${id}`);
      await module.references();
      if (isCurrent()) await module.load();
    },
  };
}
