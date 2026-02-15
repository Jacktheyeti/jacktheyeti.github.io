#!/usr/bin/env python3
"""
Portfolio Build Script
Reads portfolio.yaml and generates pages from templates for any
initiative/project with a local link that doesn't already have
a manually-managed index.html.

Usage:
    python3 build.py
"""

import os
import re
import sys

# ─── Minimal YAML Parser (stdlib only) ──────────────────────────────────────
# Handles the subset used by portfolio.yaml: scalars, inline arrays, objects,
# and list-of-objects. No external dependencies required.

def parse_yaml(text):
    lines = text.split('\n')
    result, _ = _parse_block(lines, 0, -1)
    return result

def _get_indent(line):
    return len(line) - len(line.lstrip())

def _parse_scalar(val):
    val = val.strip()
    if not val:
        return ''
    if val in ('true', 'True'):
        return True
    if val in ('false', 'False'):
        return False
    if val in ('null', '~'):
        return None
    # Strip surrounding quotes
    if (val.startswith('"') and val.endswith('"')) or \
       (val.startswith("'") and val.endswith("'")):
        return val[1:-1]
    # Inline array
    if val.startswith('[') and val.endswith(']'):
        return [_parse_scalar(s) for s in _split_array(val[1:-1])]
    return val

def _split_array(s):
    """Split comma-separated values, respecting quotes."""
    items = []
    current = ''
    in_quote = None
    for ch in s:
        if ch in ('"', "'") and in_quote is None:
            in_quote = ch
            current += ch
        elif ch == in_quote:
            in_quote = None
            current += ch
        elif ch == ',' and in_quote is None:
            items.append(current)
            current = ''
        else:
            current += ch
    if current.strip():
        items.append(current)
    return items

def _parse_block(lines, start, parent_indent):
    result = {}
    i = start
    while i < len(lines):
        line = lines[i]
        trimmed = line.strip()
        if not trimmed or trimmed.startswith('#'):
            i += 1
            continue
        indent = _get_indent(line)
        if indent <= parent_indent:
            break
        if trimmed.startswith('- '):
            lst, i = _parse_list(lines, i, indent)
            return lst, i
        m = re.match(r'^([^:]+?):\s*(.*)', trimmed)
        if m:
            key = m.group(1).strip()
            val = m.group(2).strip()
            if val == '':
                ni = i + 1
                while ni < len(lines) and not lines[ni].strip():
                    ni += 1
                if ni < len(lines):
                    ni_indent = _get_indent(lines[ni])
                    if ni_indent > indent:
                        if lines[ni].strip().startswith('- '):
                            result[key], i = _parse_list(lines, ni, ni_indent)
                        else:
                            result[key], i = _parse_block(lines, ni, indent)
                    else:
                        result[key] = ''
                        i += 1
                else:
                    result[key] = ''
                    i += 1
            else:
                result[key] = _parse_scalar(val)
                i += 1
        else:
            i += 1
    return result, i

def _parse_list(lines, start, list_indent):
    result = []
    i = start
    while i < len(lines):
        line = lines[i]
        trimmed = line.strip()
        if not trimmed or trimmed.startswith('#'):
            i += 1
            continue
        indent = _get_indent(line)
        if indent < list_indent:
            break
        if indent > list_indent and not trimmed.startswith('- '):
            i += 1
            continue
        if trimmed.startswith('- '):
            content = trimmed[2:].strip()
            m = re.match(r'^([^:]+?):\s*(.*)', content)
            if m:
                obj = {m.group(1).strip(): _parse_scalar(m.group(2).strip())}
                j = i + 1
                while j < len(lines):
                    sub = lines[j]
                    st = sub.strip()
                    if not st or st.startswith('#'):
                        j += 1
                        continue
                    si = _get_indent(sub)
                    if si <= indent:
                        break
                    if st.startswith('- '):
                        break
                    sm = re.match(r'^([^:]+?):\s*(.*)', st)
                    if sm:
                        sk = sm.group(1).strip()
                        sv = sm.group(2).strip()
                        if sv == '':
                            nj = j + 1
                            while nj < len(lines) and not lines[nj].strip():
                                nj += 1
                            if nj < len(lines) and _get_indent(lines[nj]) > si and lines[nj].strip().startswith('- '):
                                obj[sk], j = _parse_list(lines, nj, _get_indent(lines[nj]))
                                continue
                            obj[sk] = ''
                        else:
                            obj[sk] = _parse_scalar(sv)
                    j += 1
                result.append(obj)
                i = j
            else:
                result.append(_parse_scalar(content))
                i += 1
        else:
            break
    return result, i


# ─── Build Logic ────────────────────────────────────────────────────────────

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(REPO_ROOT, '_templates')

def load_template(name):
    path = os.path.join(TEMPLATES_DIR, f'{name}.html')
    if not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        return f.read()

def is_manually_managed(directory):
    index = os.path.join(directory, 'index.html')
    if not os.path.exists(index):
        return False
    with open(index, 'r') as f:
        first_lines = f.read(500)
    return '<!-- managed: manual -->' in first_lines

def generate_page(item, template_name):
    link = item.get('link', '')
    if not link or not link.startswith('/'):
        return None

    dir_name = link.strip('/')
    target_dir = os.path.join(REPO_ROOT, dir_name)
    target_file = os.path.join(target_dir, 'index.html')

    # Skip manually managed pages
    if is_manually_managed(target_dir):
        print(f'  SKIP  {dir_name}/ (manually managed)')
        return None

    template = load_template(template_name)
    if not template:
        print(f'  WARN  No template "{template_name}" found for {dir_name}/')
        return None

    os.makedirs(target_dir, exist_ok=True)

    # Customize the template with the item's title
    title = item.get('title', 'Page')
    html = template.replace(
        '<title>Case Study | Portfolio</title>',
        f'<title>{title} | Portfolio</title>'
    )
    html = html.replace(
        '<meta name="description" content="A strategic initiative case study.">',
        f'<meta name="description" content="{title}">'
    )

    with open(target_file, 'w') as f:
        f.write(html)

    print(f'  BUILD {dir_name}/index.html (from {template_name} template)')
    return target_file


def main():
    config_path = os.path.join(REPO_ROOT, 'portfolio.yaml')
    if not os.path.exists(config_path):
        print('ERROR: portfolio.yaml not found')
        sys.exit(1)

    with open(config_path, 'r') as f:
        data = parse_yaml(f.read())

    print('Portfolio Build')
    print('=' * 50)

    generated = []

    # Process initiatives → case-study template
    initiatives = data.get('initiatives', [])
    if initiatives:
        print(f'\nInitiatives ({len(initiatives)}):')
        for item in initiatives:
            result = generate_page(item, 'case-study')
            if result:
                generated.append(result)

    # Process projects → project template (if one exists)
    projects = data.get('projects', [])
    if projects:
        print(f'\nProjects ({len(projects)}):')
        for item in projects:
            result = generate_page(item, 'project')
            if result:
                generated.append(result)

    print(f'\n{"=" * 50}')
    print(f'Generated {len(generated)} page(s)')


if __name__ == '__main__':
    main()
