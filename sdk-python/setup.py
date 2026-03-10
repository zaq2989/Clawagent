from setuptools import setup, find_packages

setup(
    name="claw-network",
    version="0.1.0",
    packages=find_packages(),
    install_requires=["httpx>=0.27.0"],
    description="Python SDK for Claw Network — AI Capability Internet",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="zaq2989",
    url="https://github.com/zaq2989/Clawagent",
    python_requires=">=3.8",
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
)
