# S-11 image fixtures

Boundary fixtures are generated in-memory by `pngFixture` and the unit-test JPEG/WebP builders. This avoids committing image bytes while still exercising 10 MiB, 16 MP, 64 px, and 1024 px boundaries deterministically.
