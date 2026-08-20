#!/usr/bin/env python3
"""Validate a generated questions.json file."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def validate_database(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return [f"Cannot read JSON: {exc}"]

    topics = data.get("topics")
    if not isinstance(topics, list):
        return ["Top-level 'topics' array is missing or invalid."]

    seen_question_ids: set[str] = set()
    for topic_index, topic in enumerate(topics):
        if not isinstance(topic, dict):
            errors.append(f"Topic at index {topic_index} is not an object.")
            continue

        topic_id = topic.get("id")
        if not isinstance(topic_id, str) or not topic_id.strip():
            errors.append(f"Topic at index {topic_index} is missing a valid 'id'.")

        name = topic.get("name")
        if not isinstance(name, str) or not name.strip():
            errors.append(f"Topic '{topic_id}' is missing a valid 'name'.")

        questions = topic.get("questions")
        if not isinstance(questions, list):
            errors.append(f"Topic '{topic_id}' is missing a valid 'questions' array.")
            continue

        for question_index, question in enumerate(questions):
            if not isinstance(question, dict):
                errors.append(f"Topic '{topic_id}' has a non-object question at index {question_index}.")
                continue

            qid = question.get("id")
            if not isinstance(qid, str) or not qid.strip():
                errors.append(f"Topic '{topic_id}' has a question without a valid 'id'.")
                continue
            if qid in seen_question_ids:
                errors.append(f"Duplicate question ID: {qid}")
            seen_question_ids.add(qid)

            if not isinstance(question.get("question"), str) or not question["question"].strip():
                errors.append(f"Question '{qid}' has an empty or invalid 'question' text.")

            answers = question.get("answers")
            if not isinstance(answers, list) or len(answers) != 4:
                errors.append(f"Question '{qid}' must contain exactly four answer strings.")

            correct = question.get("correctAnswers")
            if not isinstance(correct, list):
                errors.append(f"Question '{qid}' is missing 'correctAnswers'.")
                continue
            for index in correct:
                if not isinstance(index, int) or index < 0 or index > 3:
                    errors.append(f"Question '{qid}' has invalid correct answer index {index!r}.")
                    break

            if isinstance(correct, list) and any(index not in range(4) for index in correct):
                errors.append(f"Question '{qid}' contains out-of-range correct answer indexes: {correct}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a generated questions database")
    parser.add_argument("--input", type=str, default="data/questions.json", help="Path to questions.json")
    args = parser.parse_args()

    file_path = Path(args.input)
    errors = validate_database(file_path)
    if errors:
        print("[VALIDATION FAILED]")
        for error in errors:
            print(f"- {error}")
        return 1

    print("[OK] Database is structurally valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
