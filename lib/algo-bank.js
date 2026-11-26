// 预置算法题。出题时模型只引用编号（A1、A2…），题面和用例以这里为准。
// 新增题目加在末尾，不要改已有编号，否则旧的 from 会指到别的题。

/** @type {{ id: string, topic: string, brief: string, question: string, points: string[], cases: { name: string, input: string, output: string }[] }[]} */
const ALGO_PROBLEMS = [
  {
    id: 'a-plus-b',
    topic: '两数之和',
    brief: '读入两个整数，输出它们的和',
    question: `从标准输入读入两个整数 a 和 b（以空格分隔），向标准输出打印 a + b。
整数的绝对值不超过 10^9。

输入：一行，两个整数。
输出：一行，一个整数。

样例输入：
1 2
样例输出：
3`,
    points: ['按整数相加，负数也要正确', '本题范围内结果可以用 32 位有符号整数放下', '时间 O(1)，空间 O(1)'],
    cases: [
      { name: '样例', input: '1 2', output: '3' },
      { name: '负数', input: '-8 3', output: '-5' },
      { name: '零', input: '0 0', output: '0' },
      { name: '较大整数', input: '1000000000 1000000000', output: '2000000000' },
    ],
  },
  {
    id: 'valid-parentheses',
    topic: '有效括号',
    brief: '判断只含 ()[]{} 的字符串是否括号匹配',
    question: `给定一行只包含括号的字符串，判断是否有效。左括号必须用相同类型的右括号闭合，并且按正确顺序闭合。
只会出现 ()[]{} 这三种括号。空字符串视为有效。

输入：一行字符串（可能为空）。
输出：有效打印 Yes，否则打印 No。

样例输入：
()[]{}
样例输出：
Yes`,
    points: ['用栈：左括号入栈，右括号必须和栈顶匹配再弹出', '栈空时遇到右括号，或结束时栈里还有括号，都是无效', '时间 O(n)，空间 O(n)'],
    cases: [
      { name: '样例', input: '()[]{}', output: 'Yes' },
      { name: '嵌套', input: '{[]}', output: 'Yes' },
      { name: '类型不配', input: '(]', output: 'No' },
      { name: '交叉', input: '([)]', output: 'No' },
      { name: '空串', input: '', output: 'Yes' },
      { name: '只有左括号', input: '((', output: 'No' },
    ],
  },
  {
    id: 'max-subarray',
    topic: '最大子数组和',
    brief: '求整数数组中连续子数组的最大和',
    question: `给定 n 个整数，求其中一个连续子数组（至少包含一个数），使和最大，并输出这个和。

输入：
第一行一个整数 n（1 ≤ n ≤ 1000）。
第二行 n 个整数，绝对值不超过 10^4。
输出：一行一个整数。

样例输入：
4
-2 1 -3 4
样例输出：
4`,
    points: ['以 i 结尾的最大和 = max(a[i], 前面的最大和 + a[i])', '全为负数时答案是其中最大的负数，不能当成 0', '时间 O(n)，空间 O(1)'],
    cases: [
      { name: '样例', input: '4\n-2 1 -3 4', output: '4' },
      { name: '全负数', input: '3\n-5 -1 -3', output: '-1' },
      { name: '全为正', input: '3\n1 2 3', output: '6' },
      { name: '跨过一段负数', input: '5\n5 -4 -2 6 1', output: '7' },
    ],
  },
  {
    id: 'binary-search',
    topic: '二分查找',
    brief: '在升序且无重复的数组里查找目标值的下标',
    question: `给定一个升序、无重复元素的整数数组和一个目标值，返回目标值的下标（从 0 开始）。不存在则返回 -1。

输入：
第一行两个整数 n 和 target（1 ≤ n ≤ 1000）。
第二行 n 个升序整数。
输出：一行一个整数。

样例输入：
5 3
1 2 3 4 5
样例输出：
2`,
    points: ['有序数组上用二分，每次丢掉一半', '循环不变量写清楚，避免死循环', '找不到返回 -1；时间 O(log n)，空间 O(1)'],
    cases: [
      { name: '样例', input: '5 3\n1 2 3 4 5', output: '2' },
      { name: '在开头', input: '4 1\n1 3 5 7', output: '0' },
      { name: '在末尾', input: '4 7\n1 3 5 7', output: '3' },
      { name: '不存在', input: '3 9\n1 2 3', output: '-1' },
      { name: '只有一个', input: '1 1\n1', output: '0' },
    ],
  },
];

function algoCatalog() {
  return ALGO_PROBLEMS.map((p, i) => `A${i + 1}【${p.topic}】${p.brief}`).join('\n');
}

module.exports = { ALGO_PROBLEMS, algoCatalog };
