import { readFile, readdir } from "node:fs/promises";

export interface MarketingWorkspace {
  id: string;
  name: string;
  active: boolean;
  brand: {
    name: string;
    description: string;
    toneOfVoice: string;
    targetAudience: string[];
    competitors: string[];
    forbiddenTerms?: string[];
    valuePropositions?: string[];
    /** Fragmentos de caminho que o HTML final precisa linkar (ex: ["/#funcionalidades"]). */
    requiredLinks?: string[];
  };
  goals: {
    primary: "leads" | "traffic" | "brand" | "sales";
    monthlyLeadTarget?: number;
    monthlyTrafficTarget?: number;
  };
  channels: {
    blog: boolean;
    instagram: boolean;
    linkedin: boolean;
  };
  integrations: {
    siteUrl: string;
    cms: { provider: "nextassist"; apiUrl: string };
    searchConsole?: { siteUrl: string; sitemapUrl: string };
    instagram?: { apiVersion: string };
  };
  autonomy: {
    mode: "copilot" | "semi-autonomous" | "autonomous";
  };
  secrets: {
    required: string[];
    optional?: string[];
  };
}

const DEFAULT_ROOT = new URL("../workspaces/", import.meta.url);

/** Carrega um workspace pelo id (nome da pasta em `workspaces/`). */
export async function loadWorkspace(id: string, root: URL = DEFAULT_ROOT): Promise<MarketingWorkspace> {
  const fileUrl = new URL(`${id}/workspace.json`, root);
  let raw: string;
  try {
    raw = await readFile(fileUrl, "utf-8");
  } catch {
    throw new Error(`Workspace "${id}" não encontrado (esperado em workspaces/${id}/workspace.json).`);
  }
  const workspace = JSON.parse(raw) as MarketingWorkspace;
  if (workspace.id !== id) {
    throw new Error(`workspace.json de "${id}" declara id "${workspace.id}" — precisa bater com o nome da pasta.`);
  }
  return workspace;
}

/** Lista todos os workspaces ativos cadastrados em `workspaces/`. */
export async function listWorkspaces(root: URL = DEFAULT_ROOT): Promise<MarketingWorkspace[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const loaded = await Promise.all(
    entries.map(async (id) => {
      try {
        return await loadWorkspace(id, root);
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((w): w is MarketingWorkspace => w !== null && w.active);
}
