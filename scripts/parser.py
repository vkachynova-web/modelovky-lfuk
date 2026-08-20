#!/usr/bin/env python3
"""Parse LFUK text question files into a single structured JSON database.

The script scans a directory with .txt question files, validates their format,
and writes a normalized database to data/questions.json.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

EXPECTED_OPTIONS = ["a", "b", "c", "d"]
GENERIC_FILE_STEMS = {"otazky", "questions", "question_bank", "vsechny_otazky"}


def should_skip_file(file_path: Path) -> bool:
    stem = file_path.stem.lower().strip()
    return stem in GENERIC_FILE_STEMS


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = value.encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value.lower()).strip("_")
    return value or "topic"


def clean_topic_name_from_filename(filename: str) -> str:
    stem = Path(filename).stem
    stem = stem.replace("–", "-").replace("—", "-")
    stem = stem.replace("- ", "-")
    parts = re.split(r"\s*[-–—]\s*", stem)
    name = parts[-1].strip() if parts else stem.strip()
    name = re.sub(r"^\d+\s*\.?\s*", "", name)
    return name.strip()


def normalize_answer_letter(letter: str) -> str:
    normalized = (letter or "").strip().lower()
    if normalized.endswith(")"):
        normalized = normalized[:-1]
    if normalized in EXPECTED_OPTIONS:
        return normalized
    return ""


def parse_correct_answers(raw_value: str) -> List[str]:
    if raw_value is None:
        raise ValueError("Missing correct-answer value")

    cleaned = raw_value.strip()
    if not cleaned:
        raise ValueError("Correct answer is empty")

    # Accept values like: a, c ; a,c ; a, c, d ; a ; c
    candidates = [part.strip().lower() for part in re.split(r"\s*,\s*|\s+", cleaned) if part.strip()]
    if not candidates:
        raise ValueError(f"Unable to parse answer string: {raw_value!r}")

    result: List[str] = []
    for item in candidates:
        letter = normalize_answer_letter(item)
        if not letter:
            raise ValueError(f"Invalid answer token {item!r} in {raw_value!r}")
        if letter not in EXPECTED_OPTIONS:
            raise ValueError(f"Answer letter out of range: {letter!r}")
        if letter not in result:
            result.append(letter)

    return result


def split_question_blocks(raw_text: str) -> List[List[str]]:
    blocks: List[List[str]] = []
    current: List[str] = []

    for line in raw_text.splitlines():
        stripped = line.strip()
        if not stripped:
            if current:
                blocks.append(current)
                current = []
            continue
        current.append(line.rstrip())

    if current:
        blocks.append(current)

    return blocks


def parse_block_to_question(block: List[str], topic_id: str, question_index: int) -> Tuple[Dict[str, Any] | None, List[str]]:
    errors: List[str] = []
    question_lines: List[str] = []
    options: Dict[str, str] = {}
    answer_line: str | None = None

    for line in block:
        trimmed = line.strip()
        if not trimmed:
            continue

        option_match = re.match(r"^([a-zA-Z])\)\s*(.*)$", trimmed)
        if option_match:
            letter = normalize_answer_letter(option_match.group(1))
            text = option_match.group(2).strip()
            if not letter:
                errors.append(f"Invalid option label in block {question_index}: {trimmed!r}")
                continue
            if letter not in EXPECTED_OPTIONS:
                errors.append(
                    f"Question {question_index} uses unsupported option label {option_match.group(1)!r}; "
                    f"only a-d are allowed in the dataset."
                )
                continue
            if letter in options:
                errors.append(f"Duplicate option label {letter!r} in block {question_index}")
            options[letter] = text
            continue

        if re.match(r"^Správná\s+odpověď\s*:\s*.*$", trimmed, flags=re.IGNORECASE):
            answer_line = trimmed
            continue

        question_lines.append(trimmed)

    question_text = " ".join(question_lines).strip()
    if not question_text:
        errors.append(f"Question {question_index} is missing question text")

    for letter in EXPECTED_OPTIONS:
        if letter not in options:
            errors.append(f"Question {question_index} is missing option {letter.upper()})")
        elif not options[letter].strip():
            errors.append(f"Question {question_index} has an empty option {letter.upper()})")

    if len(options) != 4:
        errors.append(f"Question {question_index} should have exactly 4 options, found {len(options)}")

    if not answer_line:
        errors.append(f"Question {question_index} is missing the correct-answer line")
        return None, errors

    answer_value = answer_line.split(":", 1)[1].strip() if ":" in answer_line else ""
    try:
        correct_letters = parse_correct_answers(answer_value)
    except ValueError as exc:
        errors.append(f"Question {question_index} has an invalid correct-answer line: {exc}")
        return None, errors

    invalid_letters = [letter for letter in correct_letters if letter not in options]
    if invalid_letters:
        errors.append(
            f"Question {question_index} references non-existent correct options: {invalid_letters}. "
            f"Available options: {sorted(options.keys())}"
        )

    correct_indexes = [EXPECTED_OPTIONS.index(letter) for letter in correct_letters if letter in options]
    if correct_indexes:
        correct_indexes = sorted(set(correct_indexes))

    if not errors:
        question_id = f"{topic_id}_{question_index:03d}"
        question_obj = {
            "id": question_id,
            "question": question_text,
            "answers": [options.get(letter, "") for letter in EXPECTED_OPTIONS],
            "correctAnswers": correct_indexes,
        }
        return question_obj, []

    return None, errors


def collect_topic_data(file_path: Path) -> Tuple[Dict[str, Any] | None, List[str]]:
    topic_errors: List[str] = []
    try:
        text = file_path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return None, [f"Cannot read {file_path.name}: {exc}"]

    blocks = split_question_blocks(text)
    topic_name = clean_topic_name_from_filename(file_path.name)
    topic_id = slugify(file_path.stem)
    topic_obj = {
        "id": topic_id,
        "name": topic_name,
        "questions": [],
        "sourceFile": file_path.name,
    }

    if not blocks:
        return None, [f"File {file_path.name} does not contain any parseable questions"]

    for index, block in enumerate(blocks, start=1):
        question_obj, block_errors = parse_block_to_question(block, topic_id, index)
        if block_errors:
            topic_errors.extend([f"{file_path.name}: {error}" for error in block_errors])
        if question_obj:
            topic_obj["questions"].append(question_obj)

    if not topic_obj["questions"]:
        return None, topic_errors or [f"No valid questions extracted from {file_path.name}"]

    return topic_obj, topic_errors


def build_database(input_dir: Path) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    files = sorted(path for path in input_dir.glob("*.txt") if not should_skip_file(path))
    if not files:
        raise FileNotFoundError(f"No topic .txt files found in {input_dir}")

    topics: List[Dict[str, Any]] = []
    errors: List[str] = []
    total_questions = 0

    for file_path in files:
        topic_obj, topic_errors = collect_topic_data(file_path)
        if topic_obj:
            topics.append(topic_obj)
            total_questions += len(topic_obj["questions"])
        if topic_errors:
            errors.extend(topic_errors)

    data = OrderedDict()
    data["generatedAt"] = datetime.now(timezone.utc).isoformat()
    data["sourceDirectory"] = str(input_dir)
    data["topics"] = topics
    data["summary"] = {
        "fileCount": len(files),
        "topicCount": len(topics),
        "questionCount": total_questions,
        "errorCount": len(errors),
    }

    report = OrderedDict()
    report["status"] = "ok" if not errors else "error"
    report["errors"] = errors
    report["summary"] = data["summary"]

    return data, report


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse LFUK .txt question files into questions.json")
    parser.add_argument(
        "--input-dir",
        type=str,
        default=str(Path(__file__).resolve().parents[1] / "data" / "raw"),
        help="Directory containing topic .txt files",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=str(Path(__file__).resolve().parents[1] / "data" / "questions.json"),
        help="Destination JSON file",
    )
    parser.add_argument(
        "--report",
        type=str,
        default=str(Path(__file__).resolve().parents[1] / "data" / "validation_report.json"),
        help="Validation report JSON file",
    )
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_path = Path(args.output)
    report_path = Path(args.report)

    try:
        data, report = build_database(input_dir)
    except FileNotFoundError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if report["errors"]:
        print("[VALIDATION FAILED]")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    print("[OK] Parsed question database successfully.")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
