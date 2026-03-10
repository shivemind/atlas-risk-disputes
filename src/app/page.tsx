export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Atlas Risk Service</h1>
      <p>Risk engine, fraud signals, disputes, evidence, and representment.</p>
      <p>
        Health check:{" "}
        <a href="/api/health">
          <code>/api/health</code>
        </a>
      </p>
    </main>
  );
}
