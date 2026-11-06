# 本机专属配置：不要提交到仓库
#
# 把 config/tiers.json 换成你本地模型的真实档位后，
# 用这条命令让它不被 git 跟踪：
#
#   git update-index --skip-worktree config/tiers.json
#
# 想重新跟踪：
#
#   git update-index --no-skip-worktree config/tiers.json
#
# 更简单的做法：仓库里只提交 config/tiers.example.json，
# 本地实际用的是 config/tiers.json（已写进 .gitignore）。
config/tiers.local.json