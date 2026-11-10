// App-wide state shared by all pages: the logged-in user and the selected project.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api.js";

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const PROJECT_KEY = "df_project";

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectIdState] = useState(() => Number(localStorage.getItem(PROJECT_KEY)) || null);

  const setProjectId = (id) => {
    setProjectIdState(id);
    if (id) localStorage.setItem(PROJECT_KEY, String(id));
  };

  const loadProjects = useCallback(async () => {
    const list = await api.get("/projects");
    setProjects(list);
    // Keep the saved project if it still exists, otherwise pick the first one
    setProjectIdState((current) => {
      const keep = list.some((p) => p.id === current) ? current : list[0]?.id ?? null;
      if (keep) localStorage.setItem(PROJECT_KEY, String(keep));
      return keep;
    });
    return list;
  }, []);

  // On page load: if we have a token, find out who is logged in
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then(async ({ user }) => {
        setUser(user);
        await loadProjects();
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, [loadProjects]);

  async function login(email, password) {
    const { token, user } = await api.post("/auth/login", { email, password });
    setToken(token);
    setUser(user);
    await loadProjects();
  }

  async function register(name, email, password) {
    const { token, user } = await api.post("/auth/register", { name, email, password });
    setToken(token);
    setUser(user);
    await loadProjects();
  }

  function logout() {
    setToken(null);
    setUser(null);
    setProjects([]);
  }

  const project = projects.find((p) => p.id === projectId) || null;

  return (
    <AppContext.Provider
      value={{ user, loading, login, register, logout, projects, project, projectId, setProjectId, loadProjects }}
    >
      {children}
    </AppContext.Provider>
  );
}
