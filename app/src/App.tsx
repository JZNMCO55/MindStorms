import { useEffect } from "react";
import Background from "./components/Background";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import Inspector from "./components/Inspector";
import CorpusImport from "./components/CorpusImport";
import NewConversationModal from "./components/NewConversationModal";
import ArticleModal from "./components/ArticleModal";
import SettingsModal from "./components/SettingsModal";
import { useStore } from "./store";

export default function App() {
  const view = useStore((s) => s.view);
  const newConvoOpen = useStore((s) => s.newConvoOpen);
  const articleOpen = useStore((s) => s.articleOpen);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const hydrate = useStore((s) => s.hydrate);
  const loadMirror = useStore((s) => s.loadMirror);

  useEffect(() => {
    (async () => {
      await hydrate();
      await loadMirror();
    })();
  }, [hydrate, loadMirror]);

  return (
    <>
      <Background />
      <div className="app">
        <Sidebar />
        <section className="center panel">
          {view === "council" ? <ChatView /> : <CorpusImport />}
        </section>
        {view === "council" && <Inspector />}
      </div>
      {newConvoOpen && <NewConversationModal />}
      {articleOpen && <ArticleModal />}
      {settingsOpen && <SettingsModal />}
    </>
  );
}
