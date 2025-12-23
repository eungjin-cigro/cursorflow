#!/usr/bin/env node

/**
 * AI 기반 보안 검사 스크립트
 * OpenAI API를 사용하여 코드의 보안 취약점을 분석합니다.
 */

const fs = require('fs');
const { spawnSync } = require('child_process');

// 색상 정의
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// OpenAI API 키 확인
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.log(`${colors.yellow}⚠️  OPENAI_API_KEY not set. Skipping AI security check.${colors.reset}`);
  process.exit(0);
}

// 변경된 파일 가져오기 (PR인 경우)
function getChangedFiles() {
  try {
    const baseBranch = process.env.GITHUB_BASE_REF || 'main';
    const result = spawnSync('git', ['diff', '--name-only', `origin/${baseBranch}...HEAD`], { encoding: 'utf-8' });
    if (result.status !== 0) throw new Error(result.stderr);
    
    const files = result.stdout
      .split('\n')
      .filter(f => f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.jsx') || f.endsWith('.tsx'))
      .filter(f => f && fs.existsSync(f));
    return files;
  } catch (error) {
    // PR이 아닌 경우 최근 커밋의 파일들
    try {
      const result = spawnSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], { encoding: 'utf-8' });
      if (result.status !== 0) return [];
      
      const files = result.stdout
        .split('\n')
        .filter(f => f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.jsx') || f.endsWith('.tsx'))
        .filter(f => f && fs.existsSync(f));
      return files;
    } catch {
      return [];
    }
  }
}

// AI 보안 검사 프롬프트
function createSecurityPrompt(code, filename) {
  return `You are a security expert analyzing code for vulnerabilities. Analyze the following code and identify any security issues.

File: ${filename}

Code:
\`\`\`javascript
${code}
\`\`\`

Please analyze for:
1. **Injection vulnerabilities** (SQL, NoSQL, Command, XSS, etc.)
2. **Authentication/Authorization issues**
3. **Sensitive data exposure** (hardcoded secrets, credentials, API keys)
4. **Insecure dependencies or imports**
5. **Path traversal vulnerabilities**
6. **Insecure randomness or cryptography**
7. **Unsafe deserialization**
8. **Rate limiting or DoS vulnerabilities**
9. **CSRF/SSRF vulnerabilities**
10. **Any OWASP Top 10 issues**
11. **CodeQL-specific patterns** (tainted data flow, improper input validation, dangerous sinks like eval or child_process.exec)
12. **Code quality issues** that might trigger CodeQL's "Security and Quality" queries

Respond in JSON format:
{
  "has_issues": true/false,
  "severity": "critical" | "high" | "medium" | "low" | "none",
  "issues": [
    {
      "type": "vulnerability type",
      "severity": "critical/high/medium/low",
      "line": "approximate line number or area",
      "description": "detailed description",
      "recommendation": "how to fix"
    }
  ],
  "summary": "overall security assessment"
}`;
}

// OpenAI API 호출
async function analyzeCodeWithAI(code, filename) {
  const prompt = createSecurityPrompt(code, filename);
  
  try {
    // SECURITY NOTE: Intentionally sending code to OpenAI API for security analysis.
    // This is the expected behavior - the script's purpose is AI-powered code review.
    // Code is sent over HTTPS to OpenAI's secure API endpoint.
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a security expert specializing in code security analysis. Provide detailed, actionable security assessments in JSON format.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
  } catch (error) {
    console.error(`${colors.red}Error calling OpenAI API: ${error.message}${colors.reset}`);
    return null;
  }
}

// 보안 이슈 출력
function printSecurityIssues(filename, analysis) {
  if (!analysis.has_issues) {
    console.log(`${colors.green}✓ ${filename}: No security issues found${colors.reset}`);
    return false;
  }

  console.log(`\n${colors.red}⚠️  Security issues found in ${filename}${colors.reset}`);
  console.log(`${colors.yellow}Severity: ${analysis.severity.toUpperCase()}${colors.reset}`);
  console.log(`\n${analysis.summary}\n`);

  analysis.issues.forEach((issue, index) => {
    const severityColor = {
      critical: colors.red,
      high: colors.red,
      medium: colors.yellow,
      low: colors.blue
    }[issue.severity] || colors.reset;

    console.log(`${index + 1}. ${severityColor}[${issue.severity.toUpperCase()}]${colors.reset} ${issue.type}`);
    console.log(`   Location: ${issue.line}`);
    console.log(`   ${issue.description}`);
    console.log(`   ${colors.green}Fix: ${issue.recommendation}${colors.reset}\n`);
  });

  return analysis.severity === 'critical' || analysis.severity === 'high';
}

// 메인 실행
async function main() {
  console.log(`${colors.blue}🔍 Starting AI Security Analysis...${colors.reset}\n`);

  const changedFiles = getChangedFiles();
  
  if (changedFiles.length === 0) {
    console.log(`${colors.yellow}No code files changed. Skipping AI security check.${colors.reset}`);
    process.exit(0);
  }

  console.log(`Analyzing ${changedFiles.length} file(s):\n`);
  changedFiles.forEach(f => console.log(`  - ${f}`));
  console.log('');

  let hasBlockingIssues = false;
  let totalIssues = 0;

  for (const file of changedFiles) {
    try {
      const code = fs.readFileSync(file, 'utf-8');
      
      // 파일이 너무 크면 스킵
      if (code.length > 50000) {
        console.log(`${colors.yellow}⚠️  ${file}: File too large, skipping${colors.reset}`);
        continue;
      }

      console.log(`Analyzing ${file}...`);
      const analysis = await analyzeCodeWithAI(code, file);
      
      if (analysis) {
        const hasIssues = printSecurityIssues(file, analysis);
        if (hasIssues) {
          hasBlockingIssues = true;
          totalIssues += analysis.issues.length;
        }
      }
    } catch (error) {
      console.error(`${colors.red}Error analyzing ${file}: ${error.message}${colors.reset}`);
    }
  }

  console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.blue}📊 Security Analysis Summary${colors.reset}`);
  console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`Files analyzed: ${changedFiles.length}`);
  console.log(`Security issues found: ${totalIssues}`);

  if (hasBlockingIssues) {
    console.log(`\n${colors.red}❌ CRITICAL/HIGH severity security issues found!${colors.reset}`);
    console.log(`${colors.red}Deployment blocked. Please fix the issues above.${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`\n${colors.green}✅ No blocking security issues found${colors.reset}\n`);
    process.exit(0);
  }
}

main().catch(error => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});

