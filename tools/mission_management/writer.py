"""Writes a mission back to YAML in the same style as the hand-written files.

    text, lost = dump_mission(data, original_text)

Every field you didn't change is copied from the original file exactly as it was, comments and line
wrapping included, so a save only touches the lines you edited. Changed or new fields are written in
the house style: the usual key order, short lists in [square brackets], description and about as
folded `>` blocks wrapped at 76 characters, coords with 5 decimals.

`lost` lists any comments that sat on lines being rewritten or removed; the manager asks before
dropping them. The result is always read back and compared to `data`, so a save can't quietly
change something you didn't mean to.
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


def _place_new_key(order, key):
    """Where a new key goes: after the last existing key that comes before it in ORDER."""
    rank = {k: i for i, k in enumerate(ORDER)}
    r = rank.get(key, len(ORDER))
    pos = 0
    for i, k in enumerate(order):
        if rank.get(k, len(ORDER)) <= r:
            pos = i + 1
    order.insert(pos, key)


def dump_mission(data, original=None):
    """(text, lost_comments). Unchanged keys keep their original lines exactly."""
    header, parts, order, old = [], {}, [], {}
    if original:
        header, parts, order, _ = chunks(original)
        old = yaml.safe_load(original) or {}
    order = [k for k in order if k in data]
    for k in [k for k in ORDER if k in data] + [k for k in data if k not in ORDER]:
        if k not in order:
            _place_new_key(order, k)

    lines, lost = list(header), []
    for k in order:
        if k in parts and k in old and same_data(old[k], data[k]):
            lines += parts[k]
        else:
            lines += render_key(k, data[k])
            lost += comments_in(parts.get(k, []))
    for k in parts:
        if k not in data:
            lost += comments_in(parts[k])
    text = "\n".join(lines).rstrip("\n") + "\n"
    if not same_data(yaml.safe_load(text) or {}, data):
        raise ValueError("couldn't write this mission without changing something else; nothing was saved")
    return text, lost
