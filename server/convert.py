#!/usr/bin/env python3
# ===========================================================
#  convert.py —— PDF → DOCX 转换（布局保留）
#  -----------------------------------------------------------
#  仅依赖已安装的 pdf2docx（含 python-docx / lxml / PyMuPDF）。
#  用法：python convert.py <输入.pdf> <输出.docx>
#  成功返回 0；任何失败都打印中文原因到 stderr 并返回非 0，
#  由上游 Node 代理据此判定「转换不可用」并退回原生 PDF 解析。
#  本脚本不读取环境变量、不联网，纯本地转换。
#  输出全部为中文，并屏蔽 pdf2docx 自带的英文日志，避免终端满屏英文。
# ===========================================================
import os
import sys
import logging
import warnings
import traceback

# 关掉 pdf2docx / PyMuPDF 自带的英文告警与 INFO 日志，终端只留我们的中文提示
warnings.filterwarnings("ignore")
for _name in ("pdf2docx", "pdf2docx.converter", "pdf2docx.parser",
             "pdf2docx.layout", "pdf2docx.elements", "fitz", "pymupdf"):
    logging.getLogger(_name).setLevel(logging.CRITICAL)
logging.getLogger().setLevel(logging.ERROR)


def _import_converter():
    """导入 pdf2docx / fitz。

    PyMuPDF 的弃用提示直接写 stdout(fd=1)，连 logging/warnings 都拦不住，
    因此在导入期把真实 fd 1 临时指向 /dev/null，导入结束后恢复，
    保证终端只出现我们的中文提示。
    """
    save_fd = os.dup(1)
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)
    try:
        from pdf2docx import Converter
        return Converter
    finally:
        os.dup2(save_fd, 1)
        os.close(devnull)
        os.close(save_fd)


def _try_install():
    """尝试用当前解释器自带的 pip 安装 pdf2docx（含其依赖）。

    返回 True 表示安装流程未报错；是否真能 import 由调用方再次确认。
    外部受管环境（PEP 668，如新版 Debian/Ubuntu）会拒绝系统级安装，
    故先试普通安装，失败再带 --break-system-packages 重试。"""
    try:
        import subprocess
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "--quiet",
                 "--disable-pip-version-check", "pdf2docx"])
            return True
        except Exception:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "--quiet",
                 "--disable-pip-version-check", "--break-system-packages",
                 "pdf2docx"])
            return True
    except Exception as e:
        sys.stderr.write("自动安装 pdf2docx 失败：%s\n" % e)
        return False


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("用法：convert.py <输入.pdf> <输出.docx>\n")
        return 2

    src, dst = sys.argv[1], sys.argv[2]

    if not os.path.exists(src):
        sys.stderr.write("找不到输入文件：%s\n" % src)
        return 2

    try:
        Converter = _import_converter()
    except Exception as e:  # pdf2docx 未安装，尝试自动安装一次
        sys.stderr.write("未安装 pdf2docx，正在尝试自动安装…\n")
        if _try_install():
            try:
                Converter = _import_converter()
            except Exception as e2:
                sys.stderr.write("自动安装后仍无法导入 pdf2docx：%s\n" % e2)
                return 3
        else:
            sys.stderr.write("未安装 pdf2docx，无法转换（请先执行 "
                             "pip install pdf2docx）：%s\n" % e)
            return 3

    sys.stderr.write("正在将 PDF 转为 DOCX（保留排版与图片）…\n")
    try:
        out_dir = os.path.dirname(os.path.abspath(dst))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        cv = Converter(src)
        # 整篇转换；pdf2docx 会尽量保留文字、图片与表格的版面位置
        cv.convert(dst, start=0, end=None)
        cv.close()
    except Exception as e:
        sys.stderr.write("转换失败：%s\n" % e)
        traceback.print_exc()
        return 1

    if not os.path.exists(dst) or os.path.getsize(dst) == 0:
        sys.stderr.write("转换结果为空，可能文件损坏或受密码保护\n")
        return 4

    sys.stderr.write("✅ 已生成 DOCX：%s\n" % dst)
    return 0


if __name__ == "__main__":
    sys.exit(main())
