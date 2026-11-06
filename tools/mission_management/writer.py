"""Writes a mission back to YAML in the same style as the hand-written files.

    text, lost = dump_mission(data, original_text)

Every field you didn't change is copied from the original file exactly as it was, comments and line
wrapping included, so a save only touches the lines you edited. Changed or new fields are written in
the house style: the usual key order, short lists in [square brackets], description and about as
folded `>` blocks wrapped at 76 characters, coords with 5 decimals.

Comments (# notes) are kept: a note on a line you changed stays with that field (on the same line when
the new value fits on one line, otherwise on its own line right after it), and a note on a field you
removed moves to the field before it. A note only goes away when it's named in `remove` (the editor's
per-note Remove buttons). `lost` is what was in `remove`, for the review screen. The result is always
read back and compared to `data`, so a save can't quietly change something you didn't mean to.
"""
import datetime
import json
import re
import textwrap

import yaml

# The order keys appear in the existing files. New keys go into this order; unknown keys go last.
ORDER = ["draft", "checked", "number", "name", "mode", "who", "place", "short", "description", "about",
         "steps", "for_kids", "gear", "duration", "effort", "cost", "setting", "season", "time_of_day", "travel",
         "check_ahead", "discounts", "routine", "caution", "caution_until", "themes", "tags", "credit"]
PLACE_ORDER = ["name", "area", "address", "coords", "website", "links"]
FLOW_LISTS = {"who", "season", "check_ahead", "discounts", "themes", "tags"}
FOLDED = {"description", "about"}
WIDTH = 76          # what most of the existing description/about blocks wrap at
DATE_KEYS = {"checked", "caution_until"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
KEY_LINE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*):(\s|$)")


# ---------- writing one value ----------

def _plain_ok(s):
    """True when s can be written without quotes and still read back as the same text."""
    if s == "" or s != s.strip() or "\n" in s or " #" in s or s[0] in "#&*!|>%@`'\"{[]},?-:":
        return False
    try:
        return yaml.safe_load(f"k: {s}") == {"k": s}
    except yaml.YAMLError:
        return False


def scalar(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()[:10]
    s = str(v)
    return s if _plain_ok(s) else json.dumps(s, ensure_ascii=False)   # a JSON string is valid YAML


def _flow_item(v):
    s = scalar(v)
    if isinstance(v, str) and s == v and re.search(r"[,\[\]{}]", v):   # would split the [ ] list
        s = json.dumps(v, ensure_ascii=False)
    return s


def flow(items):
    return "[" + ", ".join(_flow_item(v) for v in items) + "]"


def coord(v):
    s = f"{v:.5f}"
    return s if float(s) == v else repr(v)


def folded(text, indent="  "):
    """A `>` block. In the data, paragraphs are separated by one newline (a blank line in the file)."""
    out = []
    for p in (" ".join(p.split()) for p in str(text).split("\n")):
        if not p:
            continue
        if out:
            out.append("")
        out.extend(textwrap.wrap(p, width=WIDTH, initial_indent=indent, subsequent_indent=indent,
                                 break_long_words=False, break_on_hyphens=False))
    return ">\n" + "\n".join(out)


def _block(key, value, indent=""):
    """One key and its value in the house style, as a list of lines."""
    pre = f"{indent}{key}:"
    if value is None:
        return [pre]
    if key in FOLDED and isinstance(value, str) and not indent:
        return [f"{pre} {folded(value)}"]
    if isinstance(value, list):
        if key == "coords":
            return [f"{pre} [{', '.join(coord(v) for v in value)}]"]
        if key in FLOW_LISTS or not value:
            return [f"{pre} {flow(value)}"]
        lines = [pre]
        for item in value:
            if isinstance(item, dict):
                for i, (k, v) in enumerate(item.items()):
                    sub = _block(k, v, indent + "    ")
                    if i == 0:
                        sub[0] = indent + "  - " + sub[0].lstrip()
                    lines += sub
            else:
                lines.append(f"{indent}  - {scalar(item)}")
        return lines
    if isinstance(value, dict):
        keys = PLACE_ORDER if key == "place" else []
        lines = [pre]
        for k in [k for k in keys if k in value] + [k for k in value if k not in keys]:
            lines += _block(k, value[k], indent + "  ")
        return lines
    if key in DATE_KEYS and isinstance(value, str) and DATE_RE.match(value):
        return [f"{pre} {value}"]          # plain, like the hand-written files (YAML reads it as a date)
    return [f"{pre} {scalar(value)}"]


def render_key(key, value):
    try:
        part = _block(key, value)
        if not same_data(yaml.safe_load("\n".join(part)), {key: value}):
            raise ValueError
        return part
    except (ValueError, yaml.YAMLError):
        # an unusual value: let PyYAML write this one key its own way rather than risk changing it
        return yaml.safe_dump({key: value}, sort_keys=False, allow_unicode=True, width=1000,
                              default_flow_style=None).rstrip("\n").split("\n")


# ---------- comparing ----------

def _norm(v):
    if isinstance(v, dict):
        return {k: _norm(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_norm(x) for x in v]
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()[:10]
    if isinstance(v, str):   # folded text: the same words and paragraphs count as the same
        return "\n".join(" ".join(p.split()) for p in v.strip().split("\n"))
    return v


def same_data(a, b):
    return _norm(a) == _norm(b)


# ---------- the original file, split into one chunk per top-level key ----------

def chunks(text):
    """(header_lines, {key: lines}, key_order, duplicate_keys). Comment lines belong to the key above them.
    A key written twice keeps its last copy, the same one YAML (and so the website) uses."""
    header, parts, order, cur, dups = [], {}, [], None, []
    for line in text.splitlines():
        m = KEY_LINE.match(line)
        if m:
            cur = m.group(1)
            if cur in parts:
                dups.append(cur)
                order.remove(cur)
            order.append(cur)
            parts[cur] = [line]
        elif cur is None:
            header.append(line)
        else:
            parts[cur].append(line)
    # a trailing blank line belongs to the file, not the last key
    if order:
        while parts[order[-1]] and not parts[order[-1]][-1].strip():
            parts[order[-1]].pop()
    return header, parts, order, sorted(set(dups))


def comments_in(lines):
    """Comments in some lines of a mission file (not counting # inside description/about text)."""
    out, in_block = [], False
    for line in lines:
        s = line.strip()
        if re.match(r"^[A-Za-z_]+:\s*[>|]", line):
            in_block = True
            continue
        if in_block and (line.startswith(" ") or not s):
            continue
        in_block = False
        if s.startswith("#"):
            out.append(s)
        else:
            m = re.search(r"\s#\s.*$", line)
            if m and line[:m.start()].count('"') % 2 == 0 and line[:m.start()].count("'") % 2 == 0:
                out.append(m.group(0).strip())
    return out


INLINE = re.compile(r"\s#\s.*$")


def _inline(line):
    """The trailing ` # note` on a line, or None (a # inside quotes doesn't count)."""
    m = INLINE.search(line)
    if m and line[:m.start()].count('"') % 2 == 0 and line[:m.start()].count("'") % 2 == 0:
        return m.group(0).strip()
    return None


def strip_comments(text, remove):
    """text without the named comments, one occurrence each. A comment on its own line loses the line; one at
    the end of a line is cut off it. # signs inside description/about text are never touched."""
    todo = list(remove or [])
    if not todo:
        return text, []
    out, done, in_block = [], [], False
    for line in text.splitlines():
        s = line.strip()
        if re.match(r"^[A-Za-z_]+:\s*[>|]", line):
            in_block = True
            out.append(line)
            continue
        if in_block and (line.startswith(" ") or not s):
            out.append(line)
            continue
        in_block = False
        if s.startswith("#") and s in todo:
            todo.remove(s)
            done.append(s)
            continue
        c = _inline(line) if not s.startswith("#") else None
        if c and c in todo:
            todo.remove(c)
            done.append(c)
            line = line[:INLINE.search(line).start()].rstrip()
        out.append(line)
    return "\n".join(out) + ("\n" if text.endswith("\n") else ""), done


def _carry(old_lines, new_lines):
    """new_lines with the notes from old_lines brought along. A note at the end of a line goes back on the
    matching line of the new block (same key at the same depth, like place > coords) when that line is a
    one-line value; every other note follows the new block on its own line."""
    notes = comments_in(old_lines)
    if not notes:
        return new_lines
    lines = list(new_lines)
    key_at = re.compile(r"^(\s*)(?:- )?([A-Za-z_][A-Za-z0-9_]*):")
    in_block = False
    for old in old_lines:
        if re.match(r"^[A-Za-z_]+:\s*[>|]", old):
            in_block = True
            continue
        if in_block and (old.startswith(" ") or not old.strip()):
            continue
        in_block = False
        note = None if old.strip().startswith("#") else _inline(old)
        m = key_at.match(old)
        if not note or not m or note not in notes:
            continue
        for i, new in enumerate(lines):
            n = key_at.match(new)
            if n and n.group(1) == m.group(1) and n.group(2) == m.group(2) \
                    and not new.rstrip().endswith((">", "|")) and _inline(new) is None:
                lines[i] = f"{new}  {note}"
                notes.remove(note)
                break
    return lines + notes            # at the left edge: always ends a folded block, never joins its text


def _place_new_key(order, key):
    """Where a new key goes: after the last existing key that comes before it in ORDER."""
    rank = {k: i for i, k in enumerate(ORDER)}
    r = rank.get(key, len(ORDER))
    pos = 0
    for i, k in enumerate(order):
        if rank.get(k, len(ORDER)) <= r:
            pos = i + 1
    order.insert(pos, key)


def dump_mission(data, original=None, remove=()):
    """(text, removed_comments). Unchanged keys keep their original lines exactly; notes are kept unless named
    in `remove`."""
    header, parts, order, old, removed = [], {}, [], {}, []
    if original:
        original, removed = strip_comments(original, remove)
        header, parts, order, _ = chunks(original)
        old = yaml.safe_load(original) or {}
    was = list(order)
    order = [k for k in order if k in data]
    for k in [k for k in ORDER if k in data] + [k for k in data if k not in ORDER]:
        if k not in order:
            _place_new_key(order, k)

    # notes on fields that are gone ride along with the nearest earlier field that's still there
    orphans = {}
    for i, k in enumerate(was):
        if k not in data and comments_in(parts[k]):
            host = next((h for h in reversed(was[:i]) if h in data), None)
            orphans.setdefault(host, []).extend(comments_in(parts[k]))

    lines = list(header) + orphans.get(None, [])
    for k in order:
        if k in parts and k in old and same_data(old[k], data[k]):
            lines += parts[k]
        else:
            lines += _carry(parts.get(k, []), render_key(k, data[k]))
        lines += orphans.get(k, [])
    text = "\n".join(lines).rstrip("\n") + "\n"
    if not same_data(yaml.safe_load(text) or {}, data):
        raise ValueError("couldn't write this mission without changing something else; nothing was saved")
    return text, removed
