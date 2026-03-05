.PHONY: up shell

up:
	docker build -t gan-cube-dev .
	docker run --rm -it -p 5173:5173 -v $(PWD):/app gan-cube-dev

shell:
	docker run --rm -it -v $(PWD):/app gan-cube-dev /bin/bash
