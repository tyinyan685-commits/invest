import React from 'react'
import ReactDOM from 'react-dom/client'
import StockAnalysisTool from './App.jsx'
import AnalysisErrorBoundary from './AnalysisErrorBoundary.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AnalysisErrorBoundary>
      <StockAnalysisTool />
    </AnalysisErrorBoundary>
  </React.StrictMode>,
)
