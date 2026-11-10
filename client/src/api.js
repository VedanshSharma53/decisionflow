// Small helper for calling the server. It adds the login token and turns errors into exceptions.
//   const meetings = await api.get("/meetings?projectId=1");
//   await api.post("/projects", { name: "My project" });

const TOKEN_KEY = "df_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function request(method, path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const isForm = body instanceof FormData; // file uploads
  if (body && !isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });

  const data = res.status === 204 ? null : await res.json().catch(() => null);

  if (res.status === 401 && token) {
    // Token expired: log out and go to the login page
    setToken(null);
    window.location.href = "/login";
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  patch: (path, body) => request("PATCH", path, body),
  del: (path) => request("DELETE", path),
};
