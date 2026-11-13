#!/usr/bin/env python3
"""
app.py - Entrypoint alias for server.py
Run directly with: python app.py or flask --app app run
"""
from server import app, main

if __name__ == "__main__":
    main()
