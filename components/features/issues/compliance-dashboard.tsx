"use client"

import { useMemo, useCallback } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import type { ScanResults } from '@/lib/code/issue-scanner'
import {
  generateComplianceReport,
  exportComplianceJSON,
  getAllRules,
} from '@/lib/code/issue-scanner'
import { ShieldCheck, Download } from 'lucide-react'
import { CoverageSummaryChart } from './coverage-chart'
import { CoverageGrid } from './coverage-grid'
import { CveSection } from './cve-section'

interface ComplianceDashboardProps {
  codeIndex: CodeIndex
  scanResults: ScanResults
}

export function ComplianceDashboard({ codeIndex, scanResults }: ComplianceDashboardProps) {
  const report = useMemo(() => {
    const allRules = getAllRules()
    return generateComplianceReport(scanResults, allRules)
  }, [scanResults])

  const handleExport = useCallback(() => {
    let url: string | undefined
    let a: HTMLAnchorElement | undefined
    try {
      const json = exportComplianceJSON(report)
      const blob = new Blob([json], { type: 'application/json' })
      url = URL.createObjectURL(blob)
      a = document.createElement('a')
      a.href = url
      a.download = `compliance-report-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
    } finally {
      if (a && document.body.contains(a)) {
        document.body.removeChild(a)
      }
      if (url) {
        URL.revokeObjectURL(url)
      }
    }
  }, [report])

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-text-secondary" />
          <h2 className="text-sm font-semibold text-text-primary tracking-tight">
            Compliance Dashboard
          </h2>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border border-foreground/10 bg-foreground/[0.04] text-text-secondary hover:bg-foreground/[0.08] hover:text-text-primary transition-colors"
        >
          <Download className="h-3 w-3" />
          Export JSON
        </button>
      </div>

      {/* Coverage Summary Chart */}
      <CoverageSummaryChart report={report} />

      {/* OWASP Top 10 Grid */}
      <CoverageGrid
        title="OWASP Top 10 — 2025"
        categories={report.owaspCoverage}
      />

      {/* CWE Top 25 Grid */}
      <CoverageGrid
        title="CWE Top 25 — 2024"
        categories={report.cweCoverage}
      />

      {/* CVE Vulnerabilities */}
      <CveSection codeIndex={codeIndex} />

      {/* Timestamp */}
      <p className="text-[10px] text-text-muted/50 text-right">
        Generated: {new Date(report.generatedAt).toLocaleString()}
      </p>
    </div>
  )
}
