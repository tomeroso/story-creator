import { useEffect, useState } from 'react';
import type { StoryProject } from '../../types/story';
import { deleteProject, listProjects } from '../../services/storage/projectStore';

interface Props {
  onOpen: (project: StoryProject) => void;
}

export function ProjectsScreen({ onOpen }: Props) {
  const [projects, setProjects] = useState<StoryProject[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setProjects(await listProjects());
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleDelete = async (id: string) => {
    await deleteProject(id);
    await refresh();
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-4">
      <h2 className="section-title">Projects</h2>
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {!loading && projects.length === 0 && (
        <p className="text-sm text-neutral-500">No saved projects yet. Start one from the Create tab.</p>
      )}
      <div className="grid gap-2">
        {projects.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2"
          >
            <div>
              <div className="text-sm font-medium">{p.name || 'Untitled'}</div>
              <div className="text-xs text-neutral-500">
                {p.segments.length} segments · updated {new Date(p.updatedAt).toLocaleString()}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onOpen(p)} className="btn-secondary text-xs">
                Open
              </button>
              <button onClick={() => handleDelete(p.id)} className="btn-ghost text-xs text-red-400">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
