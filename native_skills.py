"""Read bundled skill metadata using the installed Hermes parser."""
import json
import os
import re
import stat
import sys
from pathlib import Path


VISIBLE_NAME = re.compile(r"[a-zA-Z0-9_-]{1,64}")


def ordinary_path(path, *, directory):
    try:
        info = path.lstat()
    except OSError:
        return False
    is_expected_type = stat.S_ISDIR if directory else stat.S_ISREG
    reparse = getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
    return is_expected_type(info.st_mode) and not reparse


def catalog(source, selected=None):
    sys.path.insert(0, str(source))
    from agent.skill_utils import (
        EXCLUDED_SKILL_DIRS, SKILL_SUPPORT_DIRS, extract_skill_description,
        parse_frontmatter, skill_matches_platform,
    )

    root = source / "skills"
    if not ordinary_path(root, directory=True):
        raise ValueError("Bundled Hermes skills directory unavailable.")

    skills = []
    for folder, subfolders, filenames in os.walk(root):
        directory = Path(folder)
        manifest = directory / "SKILL.md"
        has_manifest = "SKILL.md" in filenames and ordinary_path(manifest, directory=False)
        excluded = EXCLUDED_SKILL_DIRS | SKILL_SUPPORT_DIRS if has_manifest else EXCLUDED_SKILL_DIRS
        subfolders[:] = sorted(
            name for name in subfolders
            if not name.startswith(".") and name not in excluded
            and ordinary_path(directory / name, directory=True)
        )
        if not has_manifest or directory == root:
            continue
        try:
            with manifest.open(encoding="utf-8") as stream:
                frontmatter, _ = parse_frontmatter(stream.read(8192))
        except (OSError, UnicodeError):
            continue
        name = frontmatter.get("name")
        description = extract_skill_description(frontmatter)
        category = directory.relative_to(root).parts[0] if directory.parent != root else None
        if category and not VISIBLE_NAME.fullmatch(category):
            continue
        if (isinstance(name, str) and VISIBLE_NAME.fullmatch(name)
                and description and skill_matches_platform(frontmatter)):
            if selected == (category or "") + "/" + name:
                with manifest.open(encoding="utf-8") as stream:
                    _, instructions = parse_frontmatter(stream.read(32000))
                return instructions.strip()[:16000]
            skills.append({"name": name, "description": description, "category": category})
        if len(skills) >= 256:
            break
    if selected is not None:
        raise ValueError("Unknown skill.")
    return sorted(skills, key=lambda skill: (skill["category"] or "", skill["name"]))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(catalog(Path(sys.argv[1]).resolve(), *sys.argv[2:]), ensure_ascii=False))
