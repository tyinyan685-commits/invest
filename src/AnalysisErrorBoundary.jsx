import React from "react";

export default class AnalysisErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[analysis-render-error]", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: "100vh", background: "#0f172a", color: "#e2e8f0", display: "grid", placeItems: "center", padding: 24 }}>
        <section style={{ width: "min(520px, 100%)", border: "1px solid #475569", background: "#1e293b", padding: 24, borderRadius: 8 }}>
          <h1 style={{ fontSize: 20, margin: "0 0 10px" }}>详情暂时无法显示</h1>
          <p style={{ color: "#94a3b8", lineHeight: 1.7, margin: "0 0 18px" }}>
            某项数据格式异常，页面已停止本次渲染，其他数据没有被替换或猜测。
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ border: 0, borderRadius: 6, background: "#3b82f6", color: "white", padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}
          >
            重新加载
          </button>
        </section>
      </main>
    );
  }
}
