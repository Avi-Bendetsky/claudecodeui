import { useState, useEffect } from 'react';

interface Agent {
  name: string;
  description?: string;
}

interface Crew {
  id: string;
  name: string;
  agents?: string[];
}

interface ProviderSelectorProps {
  provider: string;
  onAgentSelect?: (agentName: string | null) => void;
  onCrewSelect?: (crewId: string | null) => void;
}

export default function ProviderSelector({ provider, onAgentSelect, onCrewSelect }: ProviderSelectorProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedCrew, setSelectedCrew] = useState<string | null>(null);

  useEffect(() => {
    if (provider === 'openclaude') {
      fetch('/api/openclaude/agents')
        .then((r) => r.ok ? r.json() : [])
        .then(setAgents)
        .catch(() => setAgents([]));
    }
    if (provider === 'crewai') {
      fetch('/api/crewai/crews')
        .then((r) => r.ok ? r.json() : [])
        .then(setCrews)
        .catch(() => setCrews([]));
    }
  }, [provider]);

  if (provider === 'openclaude' && agents.length > 0) {
    return (
      <select
        className="rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground"
        value={selectedAgent || ''}
        onChange={(e) => {
          const val = e.target.value || null;
          setSelectedAgent(val);
          onAgentSelect?.(val);
        }}
      >
        <option value="">Default agent</option>
        {agents.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name}
          </option>
        ))}
      </select>
    );
  }

  if (provider === 'crewai' && crews.length > 0) {
    return (
      <select
        className="rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground"
        value={selectedCrew || ''}
        onChange={(e) => {
          const val = e.target.value || null;
          setSelectedCrew(val);
          onCrewSelect?.(val);
        }}
      >
        <option value="">Select crew...</option>
        {crews.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    );
  }

  return null;
}
