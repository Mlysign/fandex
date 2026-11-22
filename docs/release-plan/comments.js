// The comments as Claude last saw them, plus Claude's replies. index.html merges
// this with the copy in Nils's browser on every load (a comment is matched by id,
// the copy with the later `updated` wins, replies are united), so a reply written
// here shows up in the page after a refresh.
//
// To answer: put what "Copy for Claude" gave into `comments` and `status`, add
//   { "id": "r<anything unique>", "author": "Claude", "created": "<ISO time>", "text": "..." }
// to a comment's `replies`, and set that comment's `updated` to now. Resolving one
// is "status": "resolved" with a new `updated`. Leave `touched` alone: it is his.
// A status Claude changes is { "s": "done", "t": "<ISO time>", "by": "Claude" }.
window.PLAN_COMMENTS = {
  "comments": [],
  "status": {}
};
