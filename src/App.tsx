import { useState } from 'react';
import type { StoryProject } from './types/story';
import { createEmptyProject, saveProject } from './services/storage/projectStore';
import type { MediaAsset } from './services/storage/mediaStore';
import { CreateScreen } from './features/story/CreateScreen';
import { ProjectsScreen } from './features/story/ProjectsScreen';
import { MediaScreen } from './features/media/MediaScreen';
import { useStoryPipeline } from './features/story/useStoryPipeline';
import { PartsScreen } from './features/parts/PartsScreen';
import { PhysicsScreen } from './features/physics/PhysicsScreen';

type Tab = 'create' | 'parts' | 'physics' | 'projects' | 'media' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('create');
  const [project, setProject] = useState<StoryProject>(() => createEmptyProject());

  // Lifted above the Create screen (not owned by it) specifically so that
  // switching to Media/Projects/Settings and back never resets voice-model
  // loading or interrupts an in-progress narration generation/render.
  const pipeline = useStoryPipeline(project, setProject);

  const handleNewProject = () => {
    const next = createEmptyProject();
    setProject(next);
    void saveProject(next);
    setTab('create');
  };

  const openProject = (p: StoryProject) => {
    setProject(p);
    setTab('create');
  };

  const useMediaAsBackground = (asset: MediaAsset) => {
    void pipeline.setBackgroundVideo(asset.blob, asset.name);
    setTab('create');
  };

  const useMediaAsMusic = (asset: MediaAsset) => {
    pipeline.update({ backgroundMusic: asset.blob, backgroundMusicName: asset.name });
    setTab('create');
  };

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-neutral-800 sticky top-0 bg-[#0b0d10]/95 backdrop-blur z-10">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="font-semibold tracking-tight">Video Creator</div>
          <nav className="flex gap-1 text-sm">
            {(
              [
                ['create', 'Story'],
                ['parts', 'Parts'],
                ['physics', 'Physics'],
                ['projects', 'Projects'],
                ['media', 'Media'],
                ['settings', 'Settings'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-3 py-1.5 rounded-md ${
                  tab === id ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
          <button
            onClick={handleNewProject}
            className={`btn-secondary text-xs ${tab === 'create' || tab === 'projects' ? '' : 'invisible'}`}
          >
            + New story
          </button>
        </div>
      </header>

      <main className="flex-1">
        {tab === 'create' && <CreateScreen project={project} pipeline={pipeline} />}
        {/* Always mounted (just hidden) so their settings and any render in
            progress survive switching tabs. */}
        <div className={tab === 'parts' ? '' : 'hidden'}>
          <PartsScreen active={tab === 'parts'} />
        </div>
        <div className={tab === 'physics' ? '' : 'hidden'}>
          <PhysicsScreen active={tab === 'physics'} />
        </div>
        {tab === 'projects' && <ProjectsScreen onOpen={openProject} />}
        {tab === 'media' && <MediaScreen onUseAsBackground={useMediaAsBackground} onUseAsMusic={useMediaAsMusic} />}
        {tab === 'settings' && (
          <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-neutral-500">
            No settings yet — everything runs locally with no account or configuration required.
          </div>
        )}
      </main>
    </div>
  );
}
