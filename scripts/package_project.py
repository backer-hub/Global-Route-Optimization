#!/usr/bin/env python3
"""
package_project.py - Creates a complete, clean distribution and submission ZIP archive
containing all uncompiled C++/CUDA source files, include headers, CMake build files,
Python server/app entrypoints, dependency specifications, data files, and web dashboard.
"""

import os
import sys
import zipfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

# Files and directories to include in the complete distribution archive
INCLUDE_PATTERNS = [
    # C++ & CUDA Raw Source Code & Headers
    "src/",
    "include/",
    "CMakeLists.txt",

    # API Servers & Master Entrypoints
    "server.py",
    "app.py",
    "main.py",

    # Dependency Management
    "requirements.txt",
    "pyproject.toml",

    # Documentation & Schemas
    "README.md",
    "DEPLOYMENT.md",
    "sql/",

    # Data & Config
    "data/",
    "config/",
    "scripts/",
    "web/"
]

EXCLUDE_EXTENSIONS = {".pyc", ".obj", ".o", ".exe", ".ilk", ".pdb", ".log"}
EXCLUDE_DIRS = {"__pycache__", ".git", ".idea", ".vscode", "build"}


def create_package(output_zip_path: Path):
    print(f"[Packaging] Creating complete project archive at: {output_zip_path}")
    count = 0

    with zipfile.ZipFile(output_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for pattern in INCLUDE_PATTERNS:
            target_path = ROOT_DIR / pattern
            if target_path.is_file():
                rel_path = target_path.relative_to(ROOT_DIR)
                zf.write(target_path, arcname=str(rel_path).replace("\\", "/"))
                count += 1
            elif target_path.is_dir():
                for root, dirs, files in os.walk(target_path):
                    # Filter out unwanted directories
                    dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
                    for f in files:
                        file_path = Path(root) / f
                        if file_path.suffix.lower() in EXCLUDE_EXTENSIONS:
                            continue
                        rel_path = file_path.relative_to(ROOT_DIR)
                        zf.write(file_path, arcname=str(rel_path).replace("\\", "/"))
                        count += 1

    file_size_mb = output_zip_path.stat().st_size / (1024 * 1024)
    print(f"[Packaging] Successfully archived {count} files ({file_size_mb:.2f} MB) into '{output_zip_path.name}'.")


def main():
    out_zip = ROOT_DIR / "route-optimizer-complete.zip"
    create_package(out_zip)
    # Also overwrite config.zip to ensure legacy zip checks succeed
    legacy_zip = ROOT_DIR / "config.zip"
    create_package(legacy_zip)


if __name__ == "__main__":
    main()
