# NGN Banks Registry

The NGN Banks Registry aims to maintain a comprehensive directory of bank images used for various purposes, such as digital applications or financial software integrations.

## Overview

This project allows contributors to add and update bank images using a well-defined naming convention for easy integration and consistency.

## Project Structure

- `_data/images`: Directory where all bank images are stored. Each image should follow one of the naming conventions: `[cbn_code].[image_ext]` or `[ni_p_code].[image_ext]`.

## Contribution Guidelines

We welcome contributions to enhance our library of bank images. Please follow our [Contribution Guidelines](CONTRIBUTION.md) for more detailed instructions on how to contribute images.

### Key Steps:

1. **Fork and Clone:** Fork the repository and clone it to your local machine.
2. **Add Images:** Place your images in the `_data/images` directory and follow the naming conventions.
3. **Commit and Push:** Commit your changes and push them to your forked repository.
4. **Pull Request:** Open a pull request with a clear description of the changes.

## Automated Workflow

We have an automated workflow to streamline the process when a pull request is merged:

1. **Image Validation:** On every new PR, the CI/CD pipeline checks that all images meet the required naming conventions and formats.
2. **Merge & Deploy:**
   - When a PR is reviewed and merged, the workflow automatically uploads the new images a cloud storage bucket and adds them to the banks.json file.
   - The library is updated to use the newly added images.
3. **Integration Verification:** Post-merge, the system verifies that the updates are correctly integrated and working as intended.

## Getting Started

To get a local copy of the project up and running, follow these steps:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/ngn-banks-registry.git
   ```
