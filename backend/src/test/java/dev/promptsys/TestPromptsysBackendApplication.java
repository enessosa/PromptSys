package dev.promptsys;

import org.springframework.boot.SpringApplication;

public class TestPromptsysBackendApplication {

	public static void main(String[] args) {
		SpringApplication.from(PromptsysBackendApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
