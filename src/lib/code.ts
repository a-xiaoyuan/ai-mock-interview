import type { LanguageId, RunResult } from '../types';

export const LANGUAGES: { id: LanguageId; name: string; fence: string }[] = [
  { id: 'java', name: 'Java', fence: 'java' },
  { id: 'python', name: 'Python', fence: 'python' },
  { id: 'cpp', name: 'C++', fence: 'cpp' },
  { id: 'go', name: 'Go', fence: 'go' },
  { id: 'javascript', name: 'JavaScript', fence: 'javascript' },
];

/** 初始代码：读标准输入、写标准输出（ACM 模式） */
export const TEMPLATES: Record<LanguageId, string> = {
  java: `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        String line = in.readLine();
        // 在这里写你的解法

        System.out.println(line);
    }
}
`,
  python: `import sys


def main():
    data = sys.stdin.read().split()
    # 在这里写你的解法

    print(data)


main()
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    string line;
    getline(cin, line);
    // 在这里写你的解法

    cout << line << endl;
    return 0;
}
`,
  go: `package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	// 在这里写你的解法

	fmt.Println(n)
}
`,
  javascript: `const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');
// 在这里写你的解法

console.log(lines[0]);
`,
};

const LANG_KEY = 'mock-interview-code-lang';

/** 默认语言：上次用的，否则按岗位猜 */
export function defaultLanguage(role: string): LanguageId {
  const saved = localStorage.getItem(LANG_KEY) as LanguageId | null;
  if (saved && saved in TEMPLATES) return saved;
  if (/Java/.test(role)) return 'java';
  if (/Go/.test(role)) return 'go';
  if (/前端/.test(role)) return 'javascript';
  if (/客户端/.test(role)) return 'cpp';
  return 'python';
}

export const saveLanguage = (id: LanguageId) => localStorage.setItem(LANG_KEY, id);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…（共 ${s.length} 字，已截断）` : s);

/** 运行结果的一句话状态 */
export function runStatus(r: RunResult): { ok: boolean; text: string } {
  if (r.stage === 'compile') return { ok: false, text: r.timedOut ? '编译超时' : '编译失败' };
  if (r.timedOut) return { ok: false, text: '运行超时（超过 10 秒）' };
  if (r.truncated) return { ok: false, text: '输出太多，已停止运行' };
  if (r.exitCode !== 0) return { ok: false, text: `运行出错（退出码 ${r.exitCode}）` };
  return { ok: true, text: '运行成功' };
}

/** 提交给面试官的文字：说明 + 代码 + 最近一次运行（代码没改过才附上） */
export function formatSubmission(opts: { note: string; language: LanguageId; code: string; run?: { stdin: string; result: RunResult } }) {
  const lang = LANGUAGES.find((l) => l.id === opts.language)!;
  const parts = [];
  if (opts.note.trim()) parts.push(opts.note.trim());
  parts.push(`我的代码（${lang.name}）：\n\`\`\`${lang.fence}\n${opts.code.trimEnd()}\n\`\`\``);
  if (opts.run) {
    const { stdin, result } = opts.run;
    const st = runStatus(result);
    const out = result.stage === 'compile' ? result.stderr : result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '');
    parts.push(
      `运行结果：${st.text}，耗时 ${result.timeMs} ms\n输入：\n\`\`\`\n${clip(stdin.trimEnd(), 400) || '（空）'}\n\`\`\`\n输出：\n\`\`\`\n${clip(out.trimEnd(), 800) || '（无输出）'}\n\`\`\``,
    );
  }
  return parts.join('\n\n');
}

/** 把文字里的 ``` 代码块切出来，便于渲染成等宽代码 */
export function splitCodeBlocks(text: string): { code: boolean; lang: string; text: string }[] {
  const out: { code: boolean; lang: string; text: string }[] = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0;
  for (let m; (m = re.exec(text)); ) {
    if (m.index > last) out.push({ code: false, lang: '', text: text.slice(last, m.index) });
    out.push({ code: true, lang: m[1], text: m[2].replace(/\n$/, '') });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ code: false, lang: '', text: text.slice(last) });
  return out;
}
