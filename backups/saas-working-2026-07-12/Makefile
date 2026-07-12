.PHONY: install run test docker-up docker-down docker-build

# Python toolchain
VENV ?= .venv
PYTHON ?= $(VENV)/bin/python
PIP ?= $(VENV)/bin/pip
PYTEST ?= $(VENV)/bin/pytest

install:
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r backend/requirements.txt

run:
	$(PYTHON) run.py

test:
	$(PYTEST) backend/tests -q

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

docker-build:
	docker compose build
