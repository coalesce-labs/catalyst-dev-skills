// ask-copy.mjs — CTC-4075: the wording checks an ask's text gets before it is filed.
//
// Ryan, 2026-09-28, on CTC-3927: "I don't think I'm the only one who can create the flagship flag, so
// I don't know why it's telling me I need to do that. I don't know what permissions I need to add."
// The ask said "only you" for two steps an agent could do, and named neither the GitHub App nor the
// permission as GitHub shows it. These checks catch those two shapes. They warn and never refuse: a
// true "only you" exists (a login only the human holds), and the raiser is the one who knows.

/** @typedef {{ rule: string, match: string, fix: string }} AskCopyFinding */

const RULES = [
  {
    rule: "only-you",
    re: /\bonly (?:you|a human|the human|a person)\b/i,
    fix:
      "List only the steps a human really must do, and say who does the rest (\"we'll create the flag\"). " +
      "Keep \"only you\" only when it is true, and say why (\"only your account can accept the payment\").",
  },
  {
    rule: "github-app-without-link",
    re: /\bGitHub App\b/,
    unless: /https:\/\/github\.com\/(?:organizations\/[^/\s]+\/)?settings\/(?:apps|installations)\//,
    fix:
      "Name the App as GitHub shows it (\"Catalyst Cloud Connector\"), the permission as GitHub labels it " +
      "(\"Commit statuses: Read-only\"), a direct settings link, and the follow-up step (accept the new " +
      "permissions on the installation).",
  },
];

/**
 * @param {string} text  the ask's title and body, or any part of them
 * @returns {AskCopyFinding[]}
 */
export function askCopyFindings(text) {
  const findings = [];
  for (const { rule, re, unless, fix } of RULES) {
    const m = re.exec(text);
    if (m && !(unless && unless.test(text))) findings.push({ rule, match: m[0], fix });
  }
  return findings;
}
