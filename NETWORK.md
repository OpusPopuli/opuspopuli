# Commonwealth Labs Network

The Commonwealth Labs Network is a collaborative ecosystem of civic technology deployments, each serving their own jurisdiction while contributing to a shared platform.

## Overview

Commonwealth Labs provides the open-source QCKSTRT platform as a foundation for civic engagement applications. Organizations can fork the platform, customize it for their jurisdiction, and optionally join the network to benefit from shared infrastructure and community support.

## How the Network Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                    COMMONWEALTH LABS NETWORK                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │   california.   │  │    texas.       │  │   newyork.      │     │
│  │ commonwealthlabs│  │ commonwealthlabs│  │ commonwealthlabs│     │
│  │      .io        │  │      .io        │  │      .io        │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                    │               │
│           └────────────────────┼────────────────────┘               │
│                                │                                    │
│                    ┌───────────▼───────────┐                        │
│                    │   Shared Platform     │                        │
│                    │   (Upstream Repo)     │                        │
│                    └───────────────────────┘                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Network Benefits

1. **Subdomain Hosting**: Network members receive a `*.commonwealthlabs.io` subdomain
2. **Shared Infrastructure**: Access to shared services and infrastructure guidance
3. **Community Support**: Collaboration with other civic tech organizations
4. **Platform Updates**: Receive upstream improvements and security patches
5. **Visibility**: Listing in the Commonwealth Labs network directory

### Independence

Each deployment maintains full independence:
- **Own Data**: All civic data remains under the organization's control
- **Own Infrastructure**: Deploy on your own cloud account (AWS, GCP, Azure)
- **Own Customizations**: Add jurisdiction-specific features without upstream approval
- **Own Governance**: Make decisions appropriate for your community

## Joining the Network

### Requirements

1. **Non-Profit or Government Entity**: The network is for civic-focused organizations
2. **Open Source Commitment**: Maintain AGPL-3.0 licensing for platform modifications
3. **Code of Conduct**: Agree to the [Code of Conduct](CODE_OF_CONDUCT.md)
4. **Technical Capability**: Ability to deploy and maintain the platform

### Process

1. **Fork the Repository**
   ```bash
   # Fork qckstrt on GitHub
   git clone https://github.com/your-org/qckstrt.git
   cd qckstrt
   ```

2. **Create Your Region Provider**
   ```bash
   mkdir -p packages/region-provider-yourstate/src
   # Implement IRegionProvider for your jurisdiction
   ```
   See [Region Provider Guide](docs/guides/region-provider.md) for details.

3. **Deploy Your Instance**
   - Follow the [Infrastructure Guide](infra/README.md)
   - Deploy to your own cloud account
   - Configure your region provider

4. **Request Network Membership**
   - Open an issue in the main repository with the "network-membership" label
   - Provide:
     - Organization name and type (non-profit, government, etc.)
     - Jurisdiction you'll serve
     - Point of contact information
     - Desired subdomain (e.g., `california.commonwealthlabs.io`)

5. **Review and Onboarding**
   - Commonwealth Labs team reviews the request
   - Technical verification of deployment
   - Subdomain configuration
   - Addition to network directory

## Network Governance

### Upstream Contributions

Members are encouraged to contribute improvements back to the platform:

- **Bug Fixes**: Submit PRs to the upstream repository
- **New Features**: Propose and implement platform enhancements
- **Documentation**: Improve guides and documentation
- **Security**: Report vulnerabilities through the [security process](SECURITY.md)

See [Contributing Guide](CONTRIBUTING.md) for contribution guidelines.

### Platform vs. Fork Code

| Code Type | Location | Contribution Model |
|-----------|----------|-------------------|
| Platform core | Upstream repo | PRs welcomed |
| Region providers | Your fork only | Not merged upstream |
| Jurisdiction features | Your fork only | Not merged upstream |
| Bug fixes | Upstream repo | PRs required |
| Security patches | Upstream repo | PRs required |

### Staying Updated

Regularly sync your fork with upstream:

```bash
# Add upstream remote (one time)
git remote add upstream https://github.com/commonwealthlabs/qckstrt.git

# Fetch and merge updates
git fetch upstream
git checkout develop
git merge upstream/develop
```

## Technical Architecture

Each network member runs the same platform architecture:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     YOUR JURISDICTION FORK                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              BASE PLATFORM (from upstream)                   │   │
│  │  • Auth, Users, Knowledge services                          │   │
│  │  • Frontend application                                      │   │
│  │  • Region microservice                                       │   │
│  │  • All provider packages                                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              YOUR ADDITIONS (fork only)                      │   │
│  │  • region-provider-yourstate package                         │   │
│  │  • Custom scrapers for your data sources                     │   │
│  │  • Jurisdiction-specific configuration                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Sources

Each region provider connects to jurisdiction-specific data sources:

| Data Type | Example Sources |
|-----------|----------------|
| Propositions | Secretary of State APIs, ballot measure databases |
| Meetings | Legislative calendars, public meeting portals |
| Representatives | Legislature websites, civic APIs |

## Cost Considerations

Each network member is responsible for their own infrastructure costs:

| Tier | Use Case | Estimated Monthly Cost |
|------|----------|----------------------|
| Starter | Development, small pilots | ~$100-200 |
| Standard | Production, moderate traffic | ~$460-610 |
| Production | High traffic, full redundancy | ~$800-1,200 |

See [Infrastructure README](infra/README.md) for detailed cost breakdowns.

## Support

### Community Support

- **GitHub Discussions**: Ask questions, share ideas
- **Issue Tracker**: Report bugs, request features
- **Network Slack**: Private channel for network members

### Commercial Support

For organizations requiring dedicated support, see [Commercial Licensing](LICENSE-COMMERCIAL.md).

## FAQ

### Do I need to join the network to use the platform?

No. The platform is fully open source under AGPL-3.0. You can fork and deploy independently. The network provides optional benefits like subdomains and community support.

### Can I use my own domain instead of a subdomain?

Yes. Network members can use their own domain while still participating in the network. The `*.commonwealthlabs.io` subdomain is optional.

### What if I want to modify the platform significantly?

You're free to modify the platform under AGPL-3.0 terms. However, significant modifications may make it harder to receive upstream updates. Consider contributing changes that benefit all network members.

### How do I report security issues?

Follow the [Security Policy](SECURITY.md). Do not open public issues for security vulnerabilities.

## Contact

- **General Inquiries**: Open an issue with the "question" label
- **Network Membership**: Open an issue with the "network-membership" label
- **Security Issues**: See [SECURITY.md](SECURITY.md)
